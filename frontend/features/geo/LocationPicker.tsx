"use client";

import { useMemo } from "react";

import { Select } from "@/components/ui";
import type { Constituency, Station } from "@/lib/types";

export type LocationValue = { constituency_id: string; ward_id: string; station_id: string };

/**
 * Cascading Constituency → Ward → Polling station. Data-source agnostic so the
 * staff wizard (scoped /geo) and the public portal (/portal/geo) share it.
 */
export function LocationPicker({ tree, stations, stationsLoading, value, onChange, errors = {}, lockedWardId }: {
  tree: Constituency[];
  stations: Station[] | undefined;
  stationsLoading?: boolean;
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  errors?: Partial<Record<keyof LocationValue, string>>;
  /** Field agents are pinned to one ward. */
  lockedWardId?: string | null;
}) {
  const wards = useMemo(() => tree.find((c) => c.id === value.constituency_id)?.wards ?? [], [tree, value.constituency_id]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select label="County" value="mombasa" disabled>
        <option value="mombasa">Mombasa</option>
      </Select>
      <Select
        label="Constituency"
        required
        placeholder="Select constituency"
        value={value.constituency_id}
        disabled={!!lockedWardId}
        error={errors.constituency_id}
        onChange={(e) => onChange({ constituency_id: e.target.value, ward_id: "", station_id: "" })}
      >
        {tree.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select
        label="Ward"
        required
        placeholder={value.constituency_id ? "Select ward" : "Choose a constituency first"}
        value={value.ward_id}
        disabled={!value.constituency_id || !!lockedWardId}
        error={errors.ward_id}
        onChange={(e) => onChange({ ...value, ward_id: e.target.value, station_id: "" })}
      >
        {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </Select>
      <Select
        label="Polling station"
        placeholder={
          !value.ward_id ? "Choose a ward first" : stationsLoading ? "Loading stations…" : stations?.length ? "Select polling station" : "No stations loaded yet — skip"
        }
        value={value.station_id}
        disabled={!value.ward_id || stationsLoading || !stations?.length}
        error={errors.station_id}
        hint="Where they vote. Optional if unsure."
        onChange={(e) => onChange({ ...value, station_id: e.target.value })}
      >
        {stations?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
      </Select>
    </div>
  );
}
