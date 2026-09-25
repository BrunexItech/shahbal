"use client";

import { BarChart3, BookOpenText, Camera, History, Download, ExternalLink, Grid3x3, Layers, Lock, MapPin, Shapes } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { API_URL, GIS_URL } from "@/lib/config";
import { RegionsExplorer } from "@/features/map/RegionsExplorer";
import { api, download } from "@/lib/api";

const LAYERS = [
  { icon: Shapes, name: "Constituencies and wards", file: "wards", desc: "The 6 constituencies in their own colours with the 30 IEBC wards and their names on top. Click any ward for target, reached, gap, supporters and visits. A \"Ward progress\" layer shades each ward by % of target." },
  { icon: Grid3x3, name: "Capture density", file: "grid", desc: "≈550 m grid of where the field team has captured supporters. Cells with fewer than 5 records are suppressed." },
  { icon: MapPin, name: "Polling stations", file: "stations", desc: "Mapped stations sized by how many supporters are registered to vote there." },
];

const IDEAS = [
  "Bind the Visit timeline to the time slider and press play: watch the campaign's footprint grow day by day.",
  "Buffer each polling station by 1 km and look for dense capture cells outside every buffer: likely transport needs on election day.",
  "Overlay Overture building footprints to find dense estates the team hasn't reached yet.",
  "Use the Dashboard panel to compare constituencies, or build a print layout for a briefing pack.",
  "Present the ready-made Story Map to the candidate: it tours every constituency with live numbers.",
];

export default function GisLabPage() {
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  const apiBase = API_URL.startsWith("http") ? API_URL : `${origin}${API_URL}`;

  /**
   * Mint a one-time, 2-minute project link (needs re-confirmation), then hand it to
   * GeoLibre. The lab window opens immediately so popup blockers don't interfere.
   */
  async function openLab(mode: "workspace" | "briefing") {
    const win = window.open("about:blank", "_blank");
    setBusy(mode);
    try {
      const link = await api<{ url: string }>(`/map/export/project-link?mode=${mode}`, { method: "POST" });
      const lab = `${GIS_URL}?url=${encodeURIComponent(`${apiBase}${link.url}`)}&welcome=0`;
      if (win) {
        win.opener = null;
        win.location.href = lab;
      } else {
        window.location.href = lab;
      }
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Couldn't open the lab");
    } finally {
      setBusy(null);
    }
  }

  async function get(file: string) {
    setBusy(file);
    try {
      await download(`/map/export/${file}.geojson`, `mombasa-${file}.geojson`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Command" title="GIS Lab"
        subtitle="Deep spatial analysis for HQ with GeoLibre, a free, open-source GIS that runs in your browser on our own server."
        actions={
          <>
            <Button variant="secondary" icon={<BookOpenText className="size-4" />} disabled={!origin} loading={busy === "briefing"} onClick={() => openLab("briefing")}>
              Present briefing
            </Button>
            <Button variant="gold" icon={<ExternalLink className="size-4" />} disabled={!origin} loading={busy === "workspace"} onClick={() => openLab("workspace")}>
              Open analysis workspace
            </Button>
          </>
        } />

      <div className="mb-6">
        <RegionsExplorer />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="What opens in GeoLibre" subtitle="The same map as a full GIS project, generated fresh each time: filter, buffer, measure, chart and print." />
          <ul className="divide-y divide-line">
            {LAYERS.map(({ icon: Icon, name, file, desc }) => (
              <li key={file} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 sm:flex-nowrap">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-kenya-green-50 text-kenya-green"><Icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-navy-900">{name}</p>
                  <p className="text-sm text-muted">{desc}</p>
                </div>
                <Button size="sm" variant="secondary" className="ml-14 sm:ml-0" loading={busy === file} icon={<Download className="size-3.5" />} onClick={() => get(file)}>GeoJSON</Button>
              </li>
            ))}
            <li className="flex items-start gap-4 px-5 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-kenya-green-50 text-kenya-green"><Camera className="size-5" /></span>
              <div><p className="font-semibold text-navy-900">Visited places, with photos</p><p className="text-sm text-muted">Every place the team has been, exact GPS where available, sized by how many times. Click one for its latest photo, attendance and recent visits.</p></div>
            </li>
            <li className="flex items-start gap-4 px-5 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-50 text-[#7a5f0c]"><History className="size-5" /></span>
              <div><p className="font-semibold text-navy-900">Visit timeline</p><p className="text-sm text-muted">Each visit with its date. In GeoLibre, open the layer&apos;s menu and choose <b>Bind to time slider</b>, then press play to replay how the campaign spread across Mombasa.</p></div>
            </li>
            <li className="flex items-start gap-4 px-5 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean"><BarChart3 className="size-5" /></span>
              <div><p className="font-semibold text-navy-900">Dashboard charts</p><p className="text-sm text-muted">Reached by constituency, and wards by % of target.</p></div>
            </li>
            <li className="flex items-start gap-4 px-5 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-50 text-[#7a5f0c]"><BookOpenText className="size-5" /></span>
              <div><p className="font-semibold text-navy-900">Story map briefing</p><p className="text-sm text-muted">A scroll-through tour of the county and each constituency with its weakest wards. Opens with <b>Present briefing</b>.</p></div>
            </li>
          </ul>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <p className="flex items-center gap-2 font-semibold text-navy-900"><Lock className="size-4 text-kenya-green" /> Privacy by design</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>• Only totals leave the app: no names, phone numbers or ID numbers, ever.</li>
              <li>• Sparse grid cells are hidden so no individual can be located.</li>
              <li>• The lab is self-hosted behind your HQ login; sharing to public servers is switched off.</li>
              <li>• Every export is recorded in the audit trail.</li>
            </ul>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 font-semibold text-navy-900"><Layers className="size-4 text-ocean" /> Analyses to try</p>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-slate-700">{IDEAS.map((i) => <li key={i}>{i}</li>)}</ol>
          </Card>
        </div>
      </div>
    </>
  );
}
