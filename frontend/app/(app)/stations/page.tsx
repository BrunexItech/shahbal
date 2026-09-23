"use client";

import { MapPin, Plus, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Select } from "@/components/ui";
import { useGeoTree, useImportStations, useSaveStation, useStations, wardIndex } from "@/features/geo/api";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { num } from "@/lib/format";
import { can } from "@/lib/roles";
import type { Station } from "@/lib/types";

export default function StationsPage() {
  const user = useUser();
  const [wardId, setWardId] = useState("");
  const [q, setQ] = useState("");
  const { data: tree } = useGeoTree();
  const { data, isLoading, error, refetch } = useStations(wardId || undefined, q || undefined);
  const wards = useMemo(() => wardIndex(tree), [tree]);
  const [editing, setEditing] = useState<Partial<Station> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importer = useImportStations();

  async function onImport(file: File) {
    try {
      const r = await importer.mutateAsync(file);
      toast.success(`Imported: ${r.created} new, ${r.updated} updated`, { description: r.errors.length ? `${r.errors.length} rows skipped. First: ${r.errors[0]}` : undefined });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      <PageHeader eyebrow="Setup" title="Polling stations" subtitle="IEBC polling centres used for capture, targets and election-day turnout."
        actions={<>
          {can.importStations(user.role) && (
            <>
              <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
              <Button variant="secondary" loading={importer.isPending} icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}
                title="CSV columns: code,name,ward_code[,streams,registered_voters,latitude,longitude]">Import CSV</Button>
            </>
          )}
          {can.manageStations(user.role) && <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ streams: 1, is_active: true, ward_id: wardId })}>Add station</Button>}
        </>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code"
            className="h-10 min-w-60 flex-1 rounded-xl border border-line px-3 text-sm focus:border-ocean focus:outline-none focus:ring-4 focus:ring-ocean/10" />
          <select value={wardId} onChange={(e) => setWardId(e.target.value)} className="h-10 rounded-xl border border-line bg-white px-3 text-sm">
            <option value="">All wards</option>
            {tree?.map((c) => (
              <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
            ))}
          </select>
        </div>
        {isLoading ? <SkeletonRows rows={6} /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.length ? (
          <EmptyState icon={<MapPin className="size-6" />} title="No polling stations yet" body="Import the IEBC polling-station list as CSV, or add stations one by one." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/70 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Station</th><th className="px-3 py-3">Code</th><th className="px-3 py-3">Ward</th>
                  <th className="px-3 py-3 text-right">Streams</th><th className="px-3 py-3 text-right">Registered</th><th className="px-3 py-3">GPS</th><th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((s) => (
                  <tr key={s.id} className={can.manageStations(user.role) ? "cursor-pointer hover:bg-slate-50/70" : ""}
                    onClick={() => can.manageStations(user.role) && setEditing(s)}>
                    <td className="px-5 py-3 font-semibold text-navy-900">{s.name}</td>
                    <td className="px-3 py-3 font-mono text-xs">{s.code}</td>
                    <td className="px-3 py-3">{wards.get(s.ward_id)?.name}<p className="text-[11px] text-muted">{wards.get(s.ward_id)?.constituency}</p></td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.streams}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{num(s.registered_voters)}</td>
                    <td className="px-3 py-3 text-xs text-muted">{s.latitude != null ? "✓ Mapped" : "—"}</td>
                    <td className="px-5 py-3"><Badge tone={s.is_active ? "green" : "slate"} dot>{s.is_active ? "Active" : "Inactive"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && tree && <StationModal initial={editing} tree={tree} onClose={() => setEditing(null)} />}
    </>
  );
}

function StationModal({ initial, tree, onClose }: { initial: Partial<Station>; tree: NonNullable<ReturnType<typeof useGeoTree>["data"]>; onClose: () => void }) {
  const [s, setS] = useState<Partial<Station>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveStation();
  const set = (k: keyof Station, v: unknown) => setS((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v === "" ? null : Number(v));

  function submit() {
    const { id, ...body } = s;
    save.mutate({ id, ...body }, {
      onSuccess: () => { toast.success(id ? "Station updated" : "Station added"); onClose(); },
      onError: (e) => { if (e instanceof ApiError) setErrors(e.fields); toast.error(e.message); },
    });
  }

  return (
    <Modal open onClose={onClose} title={s.id ? "Edit polling station" : "Add polling station"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save station</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Station name" required className="sm:col-span-2" value={s.name ?? ""} error={errors.name} onChange={(e) => set("name", e.target.value)} />
        <Input label="IEBC code" required value={s.code ?? ""} disabled={!!s.id} error={errors.code} onChange={(e) => set("code", e.target.value)} />
        <Select label="Ward" required placeholder="Select ward" value={s.ward_id ?? ""} disabled={!!s.id} error={errors.ward_id} onChange={(e) => set("ward_id", e.target.value)}>
          {tree.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
        </Select>
        <Input label="Streams" inputMode="numeric" value={s.streams ?? ""} onChange={(e) => set("streams", n(e.target.value))} />
        <Input label="Registered voters" inputMode="numeric" value={s.registered_voters ?? ""} onChange={(e) => set("registered_voters", n(e.target.value))} />
        <Input label="Latitude" inputMode="decimal" value={s.latitude ?? ""} error={errors.latitude} onChange={(e) => set("latitude", n(e.target.value))} placeholder="-4.0435" />
        <Input label="Longitude" inputMode="decimal" value={s.longitude ?? ""} error={errors.longitude} onChange={(e) => set("longitude", n(e.target.value))} placeholder="39.6682" />
        <label className="flex items-center gap-2 text-sm font-medium text-navy-900 sm:col-span-2">
          <input type="checkbox" className="size-4 accent-kenya-green" checked={s.is_active ?? true} onChange={(e) => set("is_active", e.target.checked)} /> Active
        </label>
      </div>
    </Modal>
  );
}
