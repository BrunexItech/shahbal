"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, MapPinned, Percent, Scale, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Button, Input, Modal, Select, useConfirm } from "@/components/ui";
import { useGeoTree } from "@/features/geo/api";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

type Level = "county" | "constituency" | "ward";
type Method = "percent_registered" | "split_registered" | "split_equal";
type Plan = {
  unit: "wards" | "stations";
  items: { id: string; name: string; group: string; registered: number | null; current: number; proposed: number }[];
  total_current: number; total_proposed: number; missing_registered: number;
};

const METHODS: { id: Method; icon: typeof Percent; title: string; body: string; input: string; suffix?: string }[] = [
  { id: "percent_registered", icon: Percent, title: "% of registered voters", body: "Each area's target is a share of its IEBC registered voters.", input: "Percentage", suffix: "%" },
  { id: "split_registered", icon: Users, title: "Share a total by voters", body: "Split one total so bigger areas get bigger targets.", input: "Total target" },
  { id: "split_equal", icon: Scale, title: "Share a total equally", body: "Every area gets the same target.", input: "Total target" },
];

/**
 * Set targets for a whole level at once — county → wards, constituency → its wards,
 * ward → its polling stations — with a live preview grouped by area before saving.
 */
export function TargetPlanner({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const hq = user.role === "super_admin";
  const tree = useGeoTree();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [level, setLevel] = useState<Level>(hq ? "county" : "constituency");
  const [consId, setConsId] = useState<string>(user.constituency_id ?? "");
  const [wardId, setWardId] = useState<string>("");
  const [method, setMethod] = useState<Method>("percent_registered");
  const [value, setValue] = useState("40");

  const constituencies = useMemo(() => (tree.data ?? []).filter((c) => hq || c.id === user.constituency_id), [tree.data, hq, user.constituency_id]);
  const wards = useMemo(() => constituencies.flatMap((c) => c.wards.map((w) => ({ ...w, cons: c.name }))), [constituencies]);
  useEffect(() => {
    if (!consId && constituencies[0]) setConsId(constituencies[0].id);
    if (!wardId && wards[0]) setWardId(wards[0].id);
  }, [constituencies, wards, consId, wardId]);

  const body = useMemo(() => {
    const v = Number(value);
    if (!v || v <= 0 || (method === "percent_registered" && v > 100)) return null;
    const area_id = level === "constituency" ? consId : level === "ward" ? wardId : undefined;
    if (level !== "county" && !area_id) return null;
    return { level, area_id, method, value: v };
  }, [level, consId, wardId, method, value]);

  const [debounced, setDebounced] = useState(body);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(body), 350);
    return () => clearTimeout(t);
  }, [body]);

  const preview = useQuery({
    queryKey: ["target-plan", debounced],
    queryFn: () => api<Plan>("/geo/targets/preview", { method: "POST", body: debounced }),
    enabled: !!debounced,
    retry: false,
  });
  const apply = useMutation({
    mutationFn: () => api<Plan>("/geo/targets/apply", { method: "POST", body }),
    onSuccess: (p) => {
      for (const k of ["dashboard", "geo", "map"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(`Targets saved: ${num(p.total_proposed)} across ${p.items.length} ${p.unit}`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const groups = useMemo(() => {
    const m = new Map<string, Plan["items"]>();
    for (const it of preview.data?.items ?? []) m.set(it.group, [...(m.get(it.group) ?? []), it]);
    return [...m.entries()];
  }, [preview.data]);
  const p = preview.data;
  const m = METHODS.find((x) => x.id === method)!;

  return (
    <Modal open onClose={onClose} size="lg" title="Plan targets" subtitle="Set a whole level at once. Constituency and county totals are always the sum of their wards."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!p || !body || preview.isFetching} loading={apply.isPending}
          onClick={async () => {
            if (await confirm({ title: `Save ${p?.items.length} new targets?`, body: `Total becomes ${num(p?.total_proposed)} (was ${num(p?.total_current)}). You can change any single ${p?.unit === "stations" ? "station" : "ward"} later.`, confirmLabel: "Save targets" }))
              apply.mutate();
          }}>Save targets</Button>
      </>}>
      <div className="space-y-5">
        {/* 1 · Where */}
        <div>
          <p className="mb-2 text-xs font-bold tracking-[.14em] text-slate-500 uppercase">1 · Where</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["county", Landmark, "Whole county", "All 30 wards"],
              ["constituency", Building2, "One constituency", "Its wards"],
              ["ward", MapPinned, "One ward", "Its polling stations"],
            ] as const).filter(([id]) => hq || id !== "county").map(([id, Icon, title, sub]) => (
              <button key={id} onClick={() => setLevel(id)}
                className={cn("flex items-center gap-3 rounded-2xl p-3 text-left ring-1 transition", level === id ? "bg-navy-950 text-white ring-navy-950" : "bg-white ring-line hover:bg-slate-50")}>
                <Icon className={cn("size-5 shrink-0", level === id ? "text-gold" : "text-ocean")} />
                <span><span className="block text-sm font-bold">{title}</span><span className={cn("text-xs", level === id ? "text-slate-300" : "text-slate-500")}>{sub}</span></span>
              </button>
            ))}
          </div>
          {level === "constituency" && (
            <Select className="mt-3" label="Constituency" value={consId} onChange={(e) => setConsId(e.target.value)}>
              {constituencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          {level === "ward" && (
            <Select className="mt-3" label="Ward" value={wardId} onChange={(e) => setWardId(e.target.value)}>
              {constituencies.map((c) => (
                <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
              ))}
            </Select>
          )}
        </div>

        {/* 2 · How */}
        <div>
          <p className="mb-2 text-xs font-bold tracking-[.14em] text-slate-500 uppercase">2 · How</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {METHODS.map((x) => (
              <button key={x.id} onClick={() => { setMethod(x.id); if (x.id === "percent_registered" && Number(value) > 100) setValue("40"); }}
                className={cn("rounded-2xl p-3 text-left ring-1 transition", method === x.id ? "bg-gold-50 ring-2 ring-gold" : "bg-white ring-line hover:bg-slate-50")}>
                <x.icon className="size-5 text-[#7a5f0c]" />
                <p className="mt-2 text-sm font-bold text-navy-900">{x.title}</p>
                <p className="text-xs text-slate-500">{x.body}</p>
              </button>
            ))}
          </div>
          <div className="mt-3 max-w-xs">
            <Input label={m.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
              hint={method === "percent_registered" ? "e.g. 40 means 40% of registered voters" : "The total to share out"} />
          </div>
        </div>

        {/* 3 · Preview */}
        <div>
          <div className="mb-2 flex items-end justify-between gap-3">
            <p className="text-xs font-bold tracking-[.14em] text-slate-500 uppercase">3 · Preview</p>
            {p && <p className="text-sm text-slate-600">Total <b className="text-navy-900">{num(p.total_current)}</b> → <b className="text-kenya-green">{num(p.total_proposed)}</b></p>}
          </div>
          {p && p.missing_registered > 0 && method !== "split_equal" && (
            <p className="mb-2 rounded-xl bg-gold-50 px-3 py-2 text-sm text-[#7a5f0c] ring-1 ring-gold/30">
              {p.missing_registered} {p.unit === "stations" ? "station" : "ward"}{p.missing_registered > 1 ? "s have" : " has"} no registered-voter figure.
              {method === "percent_registered" ? " Their current target is kept." : " They get no share of the total."}
            </p>
          )}
          <div className="max-h-[42vh] overflow-y-auto rounded-2xl ring-1 ring-line">
            {preview.isFetching && !p ? (
              <div className="grid h-40 place-items-center"><Spinner /></div>
            ) : preview.error ? (
              <p className="p-4 text-sm text-kenya-red">{preview.error.message}</p>
            ) : !p ? (
              <p className="p-4 text-sm text-slate-500">Enter a value to see the new targets.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr><th className="px-3 py-2 text-left">{p.unit === "stations" ? "Polling station" : "Ward"}</th><th className="px-3 py-2 text-right">Registered</th><th className="px-3 py-2 text-right">Now</th><th className="px-3 py-2 text-right">New</th></tr>
                </thead>
                <tbody>
                  {groups.map(([g, items]) => (
                    <GroupRows key={g} name={g} items={items} unit={p.unit} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function GroupRows({ name, items, unit }: { name: string; items: Plan["items"]; unit: Plan["unit"] }) {
  const cur = items.reduce((a, i) => a + i.current, 0);
  const next = items.reduce((a, i) => a + i.proposed, 0);
  return (
    <>
      <tr className="border-t border-line bg-white">
        <td colSpan={4} className="px-3 pt-3 pb-1.5">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wider text-navy-900 uppercase">
            {unit === "wards" && <span className="size-2.5 rounded-full" style={{ background: CONSTITUENCY_COLORS[name] ?? "#94a3b8" }} />}
            {name} <span className="font-medium tracking-normal normal-case text-slate-500">· {num(cur)} → <b className="text-navy-900">{num(next)}</b></span>
          </span>
        </td>
      </tr>
      {items.map((i) => {
        const d = i.proposed - i.current;
        return (
          <tr key={i.id} className="border-t border-line/60">
            <td className="px-3 py-2 text-navy-900">{i.name}</td>
            <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{i.registered != null ? num(i.registered) : "—"}</td>
            <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{num(i.current)}</td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">
              <span className={cn(d > 0 ? "text-kenya-green" : d < 0 ? "text-kenya-red" : "text-navy-900")}>{num(i.proposed)}</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}
