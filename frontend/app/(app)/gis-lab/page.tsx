"use client";

import { EmptyState, Card } from "@/components/ui";
import { GisWorkspace } from "@/features/gis/GisWorkspace";
import { useUser } from "@/lib/auth";
import { can } from "@/lib/roles";

export default function GisLabPage() {
  const user = useUser();
  if (!can.gisLab(user.role)) return <Card><EmptyState title="GIS Lab is for HQ" body="Ask HQ for the maps you need." /></Card>;
  return <GisWorkspace />;
}
