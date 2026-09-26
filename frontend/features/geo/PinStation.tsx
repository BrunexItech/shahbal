"use client";

import { Crosshair, MapPinned } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Button, Modal } from "@/components/ui";
import { useProposePin, useStations } from "@/features/geo/api";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { REGISTER_YEAR } from "@/lib/config";

type Fix = { lat: number; lng: number; accuracy: number };
const GOOD_ENOUGH_M = 50; // the server refuses anything less precise

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * "I'm standing at this polling station." The phone's GPS becomes the station's pin
 * once a manager approves it, so the map ends up with every centre in its exact place.
 */
export function PinStationModal({ wardId, onClose }: { wardId: string; onClose: () => void }) {
  const { data, isLoading } = useStations(wardId);
  const pin = useProposePin();
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  // Keep refining: the first GPS fix is often rough, it tightens over a few seconds.
  useEffect(() => {
    if (!navigator.geolocation) { setGpsError("This device can't share its location."); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => setFix((f) => (f && f.accuracy < p.coords.accuracy - 3 ? f : { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) })),
      () => setGpsError("Location is off or blocked. Allow location for this site and try again."),
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Nearest first, so the station you're standing at is at the top.
  const rows = useMemo(() => (data ?? []).filter((s) => s.is_active).map((s) => ({
    ...s, away: fix && s.latitude != null && s.longitude != null ? metres(fix, { lat: s.latitude, lng: s.longitude }) : null,
  })).sort((a, b) => (a.away ?? 1e9) - (b.away ?? 1e9) || a.name.localeCompare(b.name)), [data, fix]);

  const precise = !!fix && fix.accuracy <= GOOD_ENOUGH_M;
  const submit = () => {
    if (!fix || !picked) return;
    pin.mutate({ id: picked, latitude: +fix.lat.toFixed(6), longitude: +fix.lng.toFixed(6), accuracy: fix.accuracy }, {
      onSuccess: (s) => {
        toast.success(s.pin_pending ? "Pin sent. Your coordinator will confirm it." : "Station pinned.");
        onClose();
      },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <Modal open onClose={onClose} title="Pin a polling station" subtitle="Stand at the station's gate or main hall, then choose it below."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button icon={<MapPinned className="size-4" />} loading={pin.isPending} disabled={!precise || !picked} onClick={submit}>Send pin</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl bg-[#06101f] p-4 text-white">
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", precise ? "bg-kenya-green" : "bg-white/10")}>
            {fix || gpsError ? <Crosshair className="size-5" /> : <Spinner size="sm" />}
          </span>
          <div className="min-w-0 text-sm">
            {gpsError ? <p className="text-red-300">{gpsError}</p> : !fix ? <p>Finding you…</p> : (
              <>
                <p className="font-semibold">{precise ? "Location locked" : "Getting a sharper fix…"} · ±{fix.accuracy} m</p>
                <p className="text-xs text-slate-400">{precise ? "Good enough to pin." : `Needs ±${GOOD_ENOUGH_M} m or better. Step into the open and wait a few seconds.`}</p>
              </>
            )}
          </div>
        </div>

        {isLoading ? <div className="grid h-24 place-items-center"><Spinner /></div> : (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-navy-900">Which station are you at?</legend>
            <div className="max-h-[42dvh] space-y-1.5 overflow-y-auto pr-1">
              {rows.map((s) => (
                <label key={s.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 transition",
                  picked === s.id ? "bg-kenya-green/5 ring-kenya-green" : "ring-line hover:bg-slate-50")}>
                  <input type="radio" name="station" value={s.id} checked={picked === s.id} onChange={() => setPicked(s.id)} className="size-4 accent-kenya-green" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-navy-900">{s.name}</span>
                    <span className="text-xs text-slate-500">
                      {num(s.registered_voters)} registered ({REGISTER_YEAR}) · {s.away != null ? (s.away < 1000 ? `${Math.round(s.away)} m away` : `${(s.away / 1000).toFixed(1)} km away`) : "not on the map yet"}
                      {s.location_quality === "verified" && " · already confirmed"}{s.pin_pending && " · pin awaiting approval"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
