"use client";

import { Check, Copy, KeyRound, LogOut, Mail, MessageSquare, Search, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SkeletonCards } from "@/components/loaders";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Select, useConfirm } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { useGeoTree, wardIndex } from "@/features/geo/api";
import { useForceSignOut, useInviteUser, useReinvite, useRevokeInvite, useUpdateUser, useUsers, type UserInput } from "@/features/users/api";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { dateTime, timeAgo } from "@/lib/format";
import { GRANTABLE, ROLE_LABEL } from "@/lib/roles";
import type { InviteInfo, Role, User } from "@/lib/types";

const WARD_ROLES: Role[] = ["ward_coordinator", "field_agent"];
type Filter = "all" | "active" | "invited" | "disabled";

export default function TeamPage() {
  const me = useUser();
  const { data, isLoading, error, refetch } = useUsers();
  const { data: tree } = useGeoTree();
  const wards = useMemo(() => wardIndex(tree), [tree]);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<User | null>(null);
  const [issued, setIssued] = useState<{ name: string; invite: InviteInfo } | null>(null);

  const area = (u: User) =>
    u.ward_id ? wards.get(u.ward_id)?.name : u.constituency_id ? tree?.find((c) => c.id === u.constituency_id)?.name : "County-wide";

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, invited: 0, disabled: 0 } as Record<Filter, number>;
    for (const u of data ?? []) {
      c.all++;
      c[(u.status ?? "active") as Filter]++;
    }
    return c;
  }, [data]);

  const shown = (data ?? []).filter((u) => (filter === "all" || u.status === filter) &&
    (!q || `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <>
      <PageHeader eyebrow="Setup" title="Team"
        subtitle="Access is by invitation only. Each person gets a one-time link tied to their email, sets their own password and takes a profile photo."
        actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>Invite a person</Button>} />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
          {(["all", "active", "invited", "disabled"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-semibold capitalize transition", filter === f ? "bg-white text-navy-900 shadow-sm" : "text-muted")}>
              {f} <span className="ml-1 text-xs text-muted">{counts[f]}</span>
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" leading={<Search className="size-4" />} className="sm:w-72" />
      </div>

      {isLoading ? <SkeletonCards count={8} /> : error ? <Card><ErrorState error={error} onRetry={refetch} /></Card> : !shown.length ? (
        <Card><EmptyState icon={<Users className="size-6" />} title="Nobody here yet" body="Invite your first team member." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((u) => (
            <button key={u.id} onClick={() => setOpen(u)} className="group min-w-0 animate-fade-up rounded-2xl border border-line bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
              <div className="flex items-center gap-3">
                <Avatar userId={u.id} name={u.full_name} size={56} hasPhoto={u.has_photo} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold text-navy-900">
                    {u.full_name} {u.totp_enabled && <ShieldCheck className="size-4 shrink-0 text-kenya-green" aria-label="Two-step on" />}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={u.role === "super_admin" ? "navy" : "blue"}>{ROLE_LABEL[u.role]}</Badge>
                <StatusChip u={u} />
              </div>
              <p className="mt-2 truncate text-xs text-muted">
                {area(u)} · {u.status === "invited" ? "hasn't joined yet" : u.last_login_at ? `last seen ${timeAgo(u.last_login_at)}` : "never signed in"}
              </p>
            </button>
          ))}
        </div>
      )}

      {inviting && tree && (
        <InviteModal tree={tree} grantable={GRANTABLE[me.role]} onClose={() => setInviting(false)}
          onIssued={(name, invite) => { setInviting(false); setIssued({ name, invite }); }} />
      )}
      {open && tree && (
        <PersonModal user={open} area={area(open) ?? ""} tree={tree} grantable={GRANTABLE[me.role]} isSelf={open.id === me.id}
          onClose={() => setOpen(null)} onIssued={(name, invite) => { setOpen(null); setIssued({ name, invite }); }} />
      )}
      {issued && <InviteIssued {...issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function StatusChip({ u }: { u: User }) {
  if (u.status === "disabled") return <Badge tone="slate" dot>Disabled</Badge>;
  if (u.status === "invited") {
    const expired = !u.invite_expires_at || new Date(u.invite_expires_at) < new Date();
    return <Badge tone={expired ? "red" : "amber"} dot>{expired ? "Invite expired" : `Invited · expires ${timeAgo(u.invite_expires_at!).replace(" ago", "")}`}</Badge>;
  }
  return <Badge tone="green" dot>Active</Badge>;
}

function RoleArea({ role, value, onChange, tree, grantable, disabled }: {
  role: Role | undefined;
  value: Partial<UserInput>;
  onChange: (k: keyof UserInput, v: unknown) => void;
  tree: NonNullable<ReturnType<typeof useGeoTree>["data"]>;
  grantable: Role[];
  disabled?: boolean;
}) {
  return (
    <>
      <Select label="Role" required value={role ?? ""} disabled={disabled} onChange={(e) => onChange("role", e.target.value)}>
        {(role && !grantable.includes(role) ? [role, ...grantable] : grantable).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </Select>
      {role === "coordinator" && (
        <Select label="Constituency" required placeholder="Select" value={value.constituency_id ?? ""} onChange={(e) => onChange("constituency_id", e.target.value)}>
          {tree.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      {role && WARD_ROLES.includes(role) && (
        <Select label="Ward" required placeholder="Select" value={value.ward_id ?? ""} onChange={(e) => onChange("ward_id", e.target.value)}>
          {tree.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
        </Select>
      )}
    </>
  );
}

function InviteModal({ tree, grantable, onClose, onIssued }: {
  tree: NonNullable<ReturnType<typeof useGeoTree>["data"]>;
  grantable: Role[];
  onClose: () => void;
  onIssued: (name: string, invite: InviteInfo) => void;
}) {
  const [f, setF] = useState<Partial<UserInput>>({ role: grantable.includes("field_agent") ? "field_agent" : grantable.at(-1) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useInviteUser();
  const set = (k: keyof UserInput, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  function submit() {
    create.mutate(f as UserInput, {
      onSuccess: (r) => onIssued(r.user.full_name, r.invite),
      onError: (e) => { if (e instanceof ApiError) setErrors(e.fields); toast.error(e.message); },
    });
  }

  return (
    <Modal open onClose={onClose} title="Invite a person" subtitle="They'll get a one-time link that only works with this exact email."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} icon={<Mail className="size-4" />} onClick={submit}>Create invitation</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required value={f.full_name ?? ""} error={errors.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="As on their ID" />
        <Input label="Phone" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="07xx xxx xxx" hint="The link is also sent by SMS" />
        <Input label="Email" type="email" required className="sm:col-span-2" value={f.email ?? ""} error={errors.email} onChange={(e) => set("email", e.target.value)}
          placeholder="their.name@gmail.com" hint="Their personal email. They must type it again to accept, so a forwarded link is useless." />
        <RoleArea role={f.role} value={f} onChange={set} tree={tree} grantable={grantable} />
      </div>
    </Modal>
  );
}

function InviteIssued({ name, invite, onClose }: { name: string; invite: InviteInfo; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link instead.");
    }
  };
  return (
    <Modal open onClose={onClose} title={`Invitation ready for ${name.split(" ")[0]}`} subtitle={`Works once · expires ${dateTime(invite.expires_at)}`}
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <img alt="Invitation QR code" className="mx-auto size-44 rounded-2xl bg-white p-2 ring-1 ring-line"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(invite.qr_svg)}`} />
        <div className="min-w-0 space-y-3 text-sm">
          <p className="text-slate-700">In person? Let them <b>scan this code with their phone camera</b>. Otherwise share the link:</p>
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-line">
            <code className="min-w-0 flex-1 truncate px-1 text-xs text-navy-900">{invite.url}</code>
            <Button size="sm" variant="secondary" onClick={copy} icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}>{copied ? "Copied" : "Copy"}</Button>
          </div>
          <a href={`https://wa.me/?text=${encodeURIComponent(`Hello ${name.split(" ")[0]}, here is your personal invitation to the Team Shahbal platform. Open it on your own phone to set up your account (it works once and expires ${dateTime(invite.expires_at)}): ${invite.url}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1fa463] px-4 py-2.5 text-sm font-bold text-white hover:brightness-110">
            <MessageSquare className="size-4" /> Share on WhatsApp
          </a>
          <div className="flex flex-wrap gap-2">
            {invite.sent_via.includes("email") && <Badge tone="green"><Mail className="size-3" /> Emailed</Badge>}
            {invite.sent_via.includes("sms") && <Badge tone="green"><MessageSquare className="size-3" /> Sent by SMS</Badge>}
            {!invite.sent_via.some((v) => v === "email" || v === "sms") && (
              <Badge tone="amber">{invite.sent_via.includes("sms_test") ? "SMS is in test mode, so nothing was sent. Share it yourself." : "Not sent automatically. Share it yourself."}</Badge>
            )}
          </div>
          <p className="text-xs text-muted">This link is shown once. If it&apos;s lost, use <b>Resend invitation</b> on their profile.</p>
        </div>
      </div>
    </Modal>
  );
}

function PersonModal({ user, area, tree, grantable, isSelf, onClose, onIssued }: {
  user: User;
  area: string;
  tree: NonNullable<ReturnType<typeof useGeoTree>["data"]>;
  grantable: Role[];
  isSelf: boolean;
  onClose: () => void;
  onIssued: (name: string, invite: InviteInfo) => void;
}) {
  const [f, setF] = useState<Partial<UserInput>>({ full_name: user.full_name, phone: user.phone ?? "", role: user.role,
    constituency_id: user.constituency_id, ward_id: user.ward_id, is_active: user.is_active });
  const update = useUpdateUser();
  const reinvite = useReinvite();
  const revoke = useRevokeInvite();
  const signOut = useForceSignOut();
  const confirm = useConfirm();
  const set = (k: keyof UserInput, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  function save() {
    const body = { ...f, id: user.id, email: user.email } as UserInput & { id: string };
    if (body.role && !WARD_ROLES.includes(body.role)) body.ward_id = null;
    if (body.role !== "coordinator" && !WARD_ROLES.includes(body.role!)) body.constituency_id = null;
    update.mutate(body, { onSuccess: () => { toast.success("Saved"); onClose(); }, onError: (e) => toast.error(e.message) });
  }

  async function resend() {
    const active = user.status === "active";
    if (active && !(await confirm({ title: "Reset this person's access?", body: "Their current password stops working and they're signed out everywhere until they accept a new invitation.", confirmLabel: "Reset access" }))) return;
    reinvite.mutate(user.id, { onSuccess: (inv) => onIssued(user.full_name, inv), onError: (e) => toast.error(e.message) });
  }

  return (
    <Modal open onClose={onClose} size="lg" title={user.full_name} subtitle={`${ROLE_LABEL[user.role]} · ${area}`}
      footer={!isSelf && <><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={update.isPending} onClick={save}>Save changes</Button></>}>
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <div className="text-center">
          <Avatar userId={user.id} name={user.full_name} size={160} hasPhoto={user.has_photo} className="mx-auto text-4xl" />
          {!user.has_photo && <p className="mt-2 text-xs text-muted">No photo yet</p>}
          <div className="mt-3 space-y-1 text-xs text-muted">
            <p>{user.email}</p>
            <p>Joined {dateTime(user.created_at)}</p>
            <p>{user.last_login_at ? `Last sign-in ${dateTime(user.last_login_at)}` : "Never signed in"}</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={f.full_name ?? ""} disabled={isSelf} onChange={(e) => set("full_name", e.target.value)} />
            <Input label="Phone" value={f.phone ?? ""} disabled={isSelf} onChange={(e) => set("phone", e.target.value)} />
            <RoleArea role={f.role} value={f} onChange={set} tree={tree} grantable={grantable} disabled={isSelf} />
          </div>
          {!isSelf && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-navy-900">
                <input type="checkbox" className="size-4 accent-kenya-green" checked={f.is_active ?? true} onChange={(e) => set("is_active", e.target.checked)} /> Account enabled
              </label>
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                <Button size="sm" variant="secondary" loading={reinvite.isPending} icon={<KeyRound className="size-4" />} onClick={resend}>
                  {user.status === "active" ? "Reset access (new invitation)" : "Resend invitation"}
                </Button>
                {user.status === "invited" && (
                  <Button size="sm" variant="ghost" loading={revoke.isPending}
                    onClick={() => revoke.mutate(user.id, { onSuccess: () => toast.success("Invitation cancelled"), onError: (e) => toast.error(e.message) })}>Cancel invitation</Button>
                )}
                {user.status === "active" && (
                  <Button size="sm" variant="ghost" loading={signOut.isPending} icon={<LogOut className="size-4" />}
                    onClick={() => signOut.mutate(user.id, { onSuccess: () => toast.success("Signed out on all devices"), onError: (e) => toast.error(e.message) })}>Sign out everywhere</Button>
                )}
              </div>
            </>
          )}
          {isSelf && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-line">This is you. Change your photo, password and passkeys in <b>My Account</b>.</p>}
        </div>
      </div>
    </Modal>
  );
}
