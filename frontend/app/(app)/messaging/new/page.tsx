"use client";

import { AlertTriangle, CalendarClock, Send, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DotLoader } from "@/components/loaders";
import { Button, Card, CardHeader, Input, PageHeader, Segmented, SUPPORT, Textarea } from "@/components/ui";
import { useGeoTree } from "@/features/geo/api";
import { previewCampaign, useCreateCampaign } from "@/features/messaging/api";
import { ChipGroup, PhonePreview } from "@/features/messaging/components";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { CAMPAIGN_NAME } from "@/lib/config";
import { num } from "@/lib/format";
import { can } from "@/lib/roles";
import type { Audience, Channel, Preview, Support, VoterStatus } from "@/lib/types";

const PLACEHOLDERS = [
  ["{first_name}", "First name"],
  ["{ward}", "Ward"],
  ["{constituency}", "Constituency"],
  ["{station}", "Polling station"],
] as const;

export default function ComposeMessagePage() {
  const user = useUser();
  const router = useRouter();
  const { data: tree } = useGeoTree();
  const create = useCreateCampaign();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("sms");
  const [body, setBody] = useState("Habari {first_name}! ");
  const [constituencies, setConstituencies] = useState<string[]>([]);
  const [wards, setWards] = useState<string[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  // Arriving from Audiences: pre-select the chosen regions, support levels and channel.
  const params = useSearchParams();
  useEffect(() => {
    const list = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);
    if (list("c").length) setConstituencies(list("c"));
    if (list("w").length) setWards(list("w"));
    if (list("s").length) setStations(list("s"));
    if (list("support").length) setSupport(list("support") as Support[]);
    const ch = params.get("channel");
    if (ch === "sms" || ch === "whatsapp") setChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on arrival
  }, []);
  const [support, setSupport] = useState<Support[]>([]);
  const [statuses, setStatuses] = useState<VoterStatus[]>(["verified", "pending"]);
  const [notVoted, setNotVoted] = useState(false);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const wardOptions = useMemo(
    () => (tree ?? []).filter((c) => !constituencies.length || constituencies.includes(c.id)).flatMap((c) => c.wards),
    [tree, constituencies],
  );
  // Drop ward picks that fall outside a newly narrowed constituency choice.
  useEffect(() => {
    setWards((w) => w.filter((id) => wardOptions.some((o) => o.id === id)));
  }, [wardOptions]);

  const audience: Partial<Audience> = useMemo(() => ({
    // Picking wards inside a constituency narrows it to those wards; place picks otherwise add up.
    constituency_ids: constituencies.filter((cid) => !(tree ?? []).find((c) => c.id === cid)?.wards.some((w) => wards.includes(w.id))),
    ward_ids: wards, station_ids: stations, support, statuses, voted: notVoted ? false : null,
  }), [constituencies, wards, stations, support, statuses, notVoted, tree]);

  // Live, debounced preview: recipients, sample render, segment count.
  useEffect(() => {
    if (!body.trim()) return setPreview(null);
    setPreviewing(true);
    const t = setTimeout(() => {
      previewCampaign({ channel, body, audience })
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewing(false));
    }, 450);
    return () => clearTimeout(t);
  }, [channel, body, audience]);

  function insert(token: string) {
    const el = bodyRef.current;
    if (!el) return setBody((b) => b + token);
    const [s, e] = [el.selectionStart, el.selectionEnd];
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  async function submit() {
    const e: Record<string, string> = {};
    if (name.trim().length < 3) e.name = "Give this campaign a name";
    if (!body.trim()) e.body = "Write a message";
    if (preview?.unknown_placeholders.length) e.body = `Unknown placeholder: {${preview.unknown_placeholders[0]}}`;
    if (when === "later" && !at) e.at = "Pick a send time";
    if (preview && preview.recipients === 0) e.audience = "Nobody matches this audience";
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const c = await create.mutateAsync({
        name: name.trim(), channel, body: body.trim(), audience,
        // datetime-local has no zone; the campaign runs on Nairobi time.
        scheduled_at: when === "later" ? `${at}:00+03:00` : null,
      });
      toast.success(c.status === "pending_approval" ? "Sent to HQ for approval" : "Message scheduled");
      router.push(`/messaging/${c.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(err instanceof Error ? err.message : "Could not create the campaign");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Messaging" title="New message" subtitle="Choose who receives it, write it once, and every voter gets a personalised copy." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1 · Audience" subtitle="Leave a group empty to include everyone in your area." />
            <div className="space-y-5 p-5">
              {tree && tree.length > 1 && (
                <ChipGroup label="Constituencies" options={tree.map((c) => ({ value: c.id, label: c.name }))} value={constituencies} onChange={setConstituencies} />
              )}
              <ChipGroup label="Wards" options={wardOptions.map((w) => ({ value: w.id, label: w.name }))} value={wards} onChange={setWards} />
              <div className="grid gap-5 lg:grid-cols-2">
                <ChipGroup label="Support level" options={(Object.keys(SUPPORT) as Support[]).map((s) => ({ value: s, label: SUPPORT[s][1] }))}
                  value={support} onChange={setSupport} />
                <ChipGroup label="Record status" options={[{ value: "verified", label: "Verified" }, { value: "pending", label: "Pending" }]}
                  value={statuses} onChange={setStatuses} empty="Verified + pending" />
              </div>
              <label className="flex items-center gap-2 text-sm text-navy-900">
                <input type="checkbox" className="size-4 accent-kenya-green" checked={notVoted} onChange={(e) => setNotVoted(e.target.checked)} />
                Only voters not yet marked as voted <span className="text-xs text-muted">(election day)</span>
              </label>
              {stations.length > 0 && (
                <p className="flex items-center justify-between gap-3 rounded-xl bg-ocean-50 px-3 py-2 text-sm text-navy-900 ring-1 ring-ocean/20">
                  <span>Plus <b>{stations.length}</b> polling station{stations.length > 1 ? "s" : ""} chosen in Audiences</span>
                  <button type="button" onClick={() => setStations([])} className="text-xs font-semibold text-ocean hover:underline">Remove</button>
                </p>
              )}
              {errors.audience && <p className="text-xs font-medium text-kenya-red">{errors.audience}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="2 · Message" />
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
                <Input label="Campaign name" required value={name} error={errors.name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kisauni rally reminder" hint="Internal only" />
                <Segmented<Channel> label="Channel" value={channel} onChange={setChannel} options={[{ value: "sms", label: "SMS" }, { value: "whatsapp", label: "WhatsApp" }]} />
              </div>
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-muted">Insert:</span>
                  {PLACEHOLDERS.map(([token, label]) => (
                    <button key={token} type="button" onClick={() => insert(token)}
                      className="rounded-lg bg-ocean-50 px-2 py-1 text-xs font-semibold text-ocean ring-1 ring-ocean/15 hover:bg-ocean/10">{label}</button>
                  ))}
                </div>
                <Textarea ref={bodyRef} label="Text" required rows={5} maxLength={1000} value={body} error={errors.body} onChange={(e) => setBody(e.target.value)} />
                <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
                  {preview && <span>{num(preview.chars)} characters</span>}
                  {preview && channel === "sms" && <span className={preview.segments > 2 ? "font-semibold text-amber-700" : ""}>{preview.segments} SMS part{preview.segments > 1 ? "s" : ""} per voter</span>}
                  {channel === "sms" && <span>An opt-out line is added automatically.</span>}
                </p>
                {channel === "whatsapp" && (
                  <p className="mt-2 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" /> WhatsApp broadcasts go through your Meta-approved template and must follow Meta&apos;s political-content policy.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="3 · When" />
            <div className="flex flex-wrap items-end gap-4 p-5">
              <Segmented<"now" | "later"> value={when} onChange={setWhen} options={[{ value: "now", label: "As soon as possible" }, { value: "later", label: "Schedule" }]} />
              {when === "later" && (
                <Input type="datetime-local" label="Send at (Nairobi time)" value={at} error={errors.at} onChange={(e) => setAt(e.target.value)}
                  min={new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)} className="w-64" />
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold text-navy-900"><Users className="size-4" /> Recipients</p>
              {previewing && <DotLoader />}
            </div>
            <p className="mt-2 font-display text-4xl font-bold text-navy-900 tabular-nums">{preview ? num(preview.recipients) : "—"}</p>
            <p className="text-xs text-muted">Reachable voters in your area who haven&apos;t opted out.</p>
          </Card>
          <PhonePreview text={preview?.sample ?? null} channel={channel} sender={CAMPAIGN_NAME} />
          <Button size="lg" variant="gold" className="w-full" loading={create.isPending} onClick={submit}
            icon={when === "later" ? <CalendarClock className="size-4" /> : <Send className="size-4" />}>
            {can.approveMessages(user.role) ? (when === "later" ? "Schedule message" : "Send message") : "Submit for approval"}
          </Button>
          {!can.approveMessages(user.role) && <p className="text-center text-xs text-muted">HQ reviews every message before it goes out.</p>}
        </div>
      </div>
    </>
  );
}
