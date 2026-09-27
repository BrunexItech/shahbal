"use client";

import { useMemo } from "react";

import { Select } from "@/components/ui";
import type { Constituency, Station } from "@/lib/types";

export type LocationValue = { constituency_id: string; ward_id: string; station_id: string };

/** Staff capture someone else's details; the public form speaks to the person themselves. */
export const PICKER_COPY = {
  staff: {
    county: "County", constituency: "Constituency", ward: "Ward", station: "Polling station",
    pickConstituency: "Select constituency", pickWard: "Select ward", constituencyFirst: "Choose a constituency first",
    wardFirst: "Choose a ward first", loading: "Loading stations…", pickStation: "Select polling station",
    none: "No stations loaded yet. Skip this.", stationHint: "Where they vote. Optional if unsure.",
  },
  en: {
    county: "County", constituency: "Constituency", ward: "Ward", station: "Polling station",
    pickConstituency: "Select your constituency", pickWard: "Select your ward", constituencyFirst: "Choose your constituency first",
    wardFirst: "Choose your ward first", loading: "Loading stations…", pickStation: "Select your polling station",
    none: "No stations listed yet. You can skip this.", stationHint: "Where you vote. Optional if you're not sure.",
  },
  sw: {
    county: "Kaunti", constituency: "Eneo bunge", ward: "Wadi", station: "Kituo cha kupigia kura",
    pickConstituency: "Chagua eneo bunge lako", pickWard: "Chagua wadi yako", constituencyFirst: "Chagua eneo bunge kwanza",
    wardFirst: "Chagua wadi kwanza", loading: "Inapakia vituo…", pickStation: "Chagua kituo chako",
    none: "Hakuna vituo bado. Unaweza kuruka hapa.", stationHint: "Unapopigia kura. Si lazima kama huna uhakika.",
  },
};

/**
 * Cascading Constituency → Ward → Polling station. Data-source agnostic so the
 * staff wizard (scoped /geo) and the public portal (/portal/geo) share it.
 */
export function LocationPicker({ tree, stations, stationsLoading, value, onChange, errors = {}, lockedWardId, copy = PICKER_COPY.staff }: {
  tree: Constituency[];
  stations: Station[] | undefined;
  stationsLoading?: boolean;
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  errors?: Partial<Record<keyof LocationValue, string>>;
  /** Field agents are pinned to one ward. */
  lockedWardId?: string | null;
  copy?: (typeof PICKER_COPY)["staff"];
}) {
  const wards = useMemo(() => tree.find((c) => c.id === value.constituency_id)?.wards ?? [], [tree, value.constituency_id]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select label={copy.county} value="mombasa" disabled>
        <option value="mombasa">Mombasa</option>
      </Select>
      <Select
        label={copy.constituency}
        required
        placeholder={copy.pickConstituency}
        value={value.constituency_id}
        disabled={!!lockedWardId}
        error={errors.constituency_id}
        onChange={(e) => onChange({ constituency_id: e.target.value, ward_id: "", station_id: "" })}
      >
        {tree.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select
        label={copy.ward}
        required
        placeholder={value.constituency_id ? copy.pickWard : copy.constituencyFirst}
        value={value.ward_id}
        disabled={!value.constituency_id || !!lockedWardId}
        error={errors.ward_id}
        onChange={(e) => onChange({ ...value, ward_id: e.target.value, station_id: "" })}
      >
        {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </Select>
      <Select
        label={copy.station}
        placeholder={!value.ward_id ? copy.wardFirst : stationsLoading ? copy.loading : stations?.length ? copy.pickStation : copy.none}
        value={value.station_id}
        disabled={!value.ward_id || stationsLoading || !stations?.length}
        error={errors.station_id}
        hint={copy.stationHint}
        onChange={(e) => onChange({ ...value, station_id: e.target.value })}
      >
        {stations?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
      </Select>
    </div>
  );
}
