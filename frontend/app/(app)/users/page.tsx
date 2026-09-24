"use client";

import { LogOut, Plus, ShieldCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Select } from "@/components/ui";
import { useGeoTree, wardIndex } from "@/features/geo/api";
import { useSaveUser, useUsers, type UserInput } from "@/features/users/api";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { dateTime, initials } from "@/lib/format";
import { GRANTABLE, ROLE_LABEL } from "@/lib/roles";
import type { Role, User } from "@/lib/types";

const WARD_ROLES: Role[] = ["ward_coordinator", "field_agent"];

export default function UsersPage() {
  const me = useUser();
  const { data, isLoading, error, refetch } = useUsers();
  const { data: tree } = useGeoTree();
  const wards = useMemo(() => wardIndex(tree), [tree]);
  const [editing, setEditing] = useState<(Partial<UserInput> & { id?: string }) | null>(null);

  const area = (u: User) =>
    u.ward_id ? wards.get(u.ward_id)?.name : u.constituency_id ? tree?.find((c) => c.id === u.constituency_id)?.name : "County-wide";

  return (
    <>
      <PageHeader eyebrow="Setup" title="Team & roles" subtitle="Everyone only sees data inside their assigned area."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing({ role: GRANTABLE[me.role].at(-1) })}>Add team member</Button>} />
      <Card className="overflow-hidden">
        {isLoading ? <SkeletonRows rows={6} /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.length ? (
          <EmptyState icon={<Users className="size-6" />} title="No team members yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/70 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Member</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Area</th><th className="px-3 py-3">Last sign-in</th><th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((u) => (
                  <tr key={u.id} className="cursor-pointer hover:bg-slate-50/70"
                    onClick={() => setEditing({ id: u.id, full_name: u.full_name, email: u.email, phone: u.phone ?? "", role: u.role, constituency_id: u.constituency_id, ward_id: u.ward_id, is_active: u.is_active })}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-full bg-navy-900 text-xs font-bold text-gold">{initials(u.full_name)}</span>
                        <div><p className="font-semibold text-navy-900">{u.full_name}</p><p className="text-xs text-muted">{u.email}</p></div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={u.role === "super_admin" ? "navy" : "blue"}>{ROLE_LABEL[u.role]}</Badge>
                      {u.totp_enabled && <ShieldCheck className="ml-1.5 inline size-4 text-kenya-green" aria-label="2FA on" />}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{area(u)}</td>
                    <td className="px-3 py-3 text-xs text-muted">{dateTime(u.last_login_at)}</td>
                    <td className="px-5 py-3"><Badge tone={u.is_active ? "green" : "slate"} dot>{u.is_active ? "Active" : "Disabled"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && tree && <UserModal initial={editing} tree={tree} grantable={GRANTABLE[me.role]} isSelf={editing.id === me.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserModal({ initial, tree, grantable, isSelf, onClose }: {
  initial: Partial<UserInput> & { id?: string };
  tree: NonNullable<ReturnType<typeof useGeoTree>["data"]>;
  grantable: Role[];
  isSelf: boolean;
  onClose: () => void;
}) {
  const [u, setU] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveUser();
  const set = (k: keyof UserInput, v: unknown) => setU((x) => ({ ...x, [k]: v }));
  const role = u.role as Role | undefined;

  function submit() {
    const body = { ...u, password: u.password || undefined } as UserInput & { id?: string };
    if (role && !WARD_ROLES.includes(role)) body.ward_id = null;
    if (role !== "coordinator") body.constituency_id = WARD_ROLES.includes(role!) ? body.constituency_id : null;
    save.mutate(body, {
      onSuccess: () => { toast.success(u.id ? "Team member updated" : "Team member added"); onClose(); },
      onError: (e) => { if (e instanceof ApiError) setErrors(e.fields); toast.error(e.message); },
    });
  }

  return (
    <Modal open onClose={onClose} title={u.id ? "Edit team member" : "Add team member"} subtitle="They'll sign in with this email and password."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required value={u.full_name ?? ""} error={errors.full_name} onChange={(e) => set("full_name", e.target.value)} />
        <Input label="Phone" value={u.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="07xx xxx xxx" />
        <Input label="Email" type="email" required disabled={!!u.id} value={u.email ?? ""} error={errors.email} onChange={(e) => set("email", e.target.value)} />
        <Input label={u.id ? "New password" : "Password"} type="password" required={!u.id} value={u.password ?? ""} error={errors.password}
          hint={u.id ? "Leave blank to keep current" : "10+ characters with letters and numbers"} onChange={(e) => set("password", e.target.value)} />
        <Select label="Role" required value={role ?? ""} disabled={isSelf} onChange={(e) => set("role", e.target.value)}>
          {(grantable.includes(role!) ? grantable : [role!, ...grantable]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        {role === "coordinator" && (
          <Select label="Constituency" required placeholder="Select" value={u.constituency_id ?? ""} onChange={(e) => set("constituency_id", e.target.value)}>
            {tree.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
        {role && WARD_ROLES.includes(role) && (
          <Select label="Ward" required placeholder="Select" value={u.ward_id ?? ""} error={errors.ward_id} onChange={(e) => set("ward_id", e.target.value)}>
            {tree.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
          </Select>
        )}
        {u.id && !isSelf && (
          <div className="sm:col-span-2">
            <Button type="button" size="sm" variant="secondary" icon={<LogOut className="size-4" />}
              onClick={() => api(`/users/${u.id}/revoke-sessions`, { method: "POST" }).then(() => toast.success("Signed out on all devices")).catch((e) => toast.error(e.message))}>
              Force sign-out on all devices
            </Button>
          </div>
        )}
        {u.id && !isSelf && (
          <label className="flex items-center gap-2 text-sm font-medium text-navy-900 sm:col-span-2">
            <input type="checkbox" className="size-4 accent-kenya-green" checked={u.is_active ?? true} onChange={(e) => set("is_active", e.target.checked)} /> Account active
          </label>
        )}
      </div>
    </Modal>
  );
}
