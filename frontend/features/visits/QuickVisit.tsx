"use client";

import { Crosshair, LocateFixed, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Button, Input, Modal, Select } from "@/components/ui";
import { useGeoTree } from "@/features/geo/api";
import { useQuickVisit } from "@/features/visits/api";
import { ApiError } from "@/lib/api";

type Fix = { lat: number; lng: number; accuracy: number };

/**
 * One-tap "I'm here now". The phone's GPS locates the team, the server works out the
 * ward, and the visit appears on the Command Centre and GIS maps straight away —
 * so coverage stays real even when a stop wasn't planned.
 */
export function QuickVisitModal({ onClose }: { onClose: () => void }) {
  const quick = useQuickVisit();
  const tree = useGeoTree();
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [venue, setVenue] = useState("");
  const [title, setTitle] = useState("");
  const [needWard, setNeedWard] = useState(false);
  const [ward, setWard] = useState("");

  const locate = () => {
    setGpsError(null);
    setFix(null);
    if (!navigator.geolocation) return setGpsError("This device can't share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }),
      () => setGpsError("Location is off or blocked. Allow location for this site and try again."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };
  useEffect(locate, []);

  const submit = () => {
    if (!fix || venue.trim().length < 2) return;
    quick.mutate({ venue: venue.trim(), title: title.trim() || undefined, latitude: fix.lat, longitude: fix.lng, ward_id: ward || undefined }, {
      onSuccess: (v) => { toast.success(`Logged in ${v.ward_name}. It's on the map now.`); onClose(); },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 422) { setNeedWard(true); toast.error("We couldn't place you in a ward. Choose it below."); }
        else toast.error(e.message);
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="I'm here now" subtitle="Log where the team is right now. Great for unplanned stops."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="gold" icon={<MapPin className="size-4" />} loading={quick.isPending} disabled={!fix || venue.trim().length < 2 || (needWard && !ward)} onClick={submit}>Log visit</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl bg-[#06101f] p-4 text-white">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-white/10">
            {fix ? <><span className="absolute inset-0 animate-ping rounded-full bg-[#34c77b]/30" /><LocateFixed className="relative size-5 text-[#7ee2b0]" /></> : gpsError ? <Crosshair className="size-5 text-[#ff8a7a]" /> : <Spinner size="sm" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{fix ? "Location found" : gpsError ? "No location" : "Finding your location…"}</p>
            <p className="truncate text-xs text-slate-400">{fix ? `${fix.lat}, ${fix.lng} · accurate to about ${fix.accuracy} m` : gpsError ?? "Stand still for a moment with a clear view of the sky."}</p>
          </div>
          {(gpsError || fix) && <button onClick={locate} className="shrink-0 text-xs font-semibold text-gold hover:underline">Retry</button>}
        </div>
        <Input label="Where are you?" required value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Majengo market, Tononoka grounds" autoFocus />
        <Input label="What's happening?" hint="Optional" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Door to door, youth meeting" />
        {needWard && (
          <Select label="Ward" value={ward} onChange={(e) => setWard(e.target.value)} placeholder="Choose the ward">
            {(tree.data ?? []).map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
          </Select>
        )}
        <p className="text-xs text-slate-500">After logging, add photos and attendance from the visit card.</p>
      </div>
    </Modal>
  );
}
