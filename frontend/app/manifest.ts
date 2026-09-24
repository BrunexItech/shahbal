import type { MetadataRoute } from "next";

import { CAMPAIGN_NAME, CAMPAIGN_TAGLINE } from "@/lib/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: CAMPAIGN_NAME,
    short_name: CAMPAIGN_NAME.length > 12 ? "Campaign HQ" : CAMPAIGN_NAME,
    description: CAMPAIGN_TAGLINE,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#071427",
    theme_color: "#0b1f3a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Capture voter", url: "/voters/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Election day", url: "/election", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
