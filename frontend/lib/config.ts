export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
export const CAMPAIGN_NAME = process.env.NEXT_PUBLIC_CAMPAIGN_NAME ?? "Team Shahbal";
export const CAMPAIGN_TAGLINE = process.env.NEXT_PUBLIC_CAMPAIGN_TAGLINE ?? "Mombasa 2027 · Campaign Command";
export const CANDIDATE_NAME = process.env.NEXT_PUBLIC_CANDIDATE_NAME ?? "Suleiman Shahbal";
/** Free, keyless OpenFreeMap tiles by default; point at a self-hosted Protomaps style for production. */
export const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/positron";
/** GeoLibre GIS Lab, served on the same origin by the gateway (see deploy/nginx/gateway.conf). */
export const GIS_URL = process.env.NEXT_PUBLIC_GIS_URL ?? "/gis/";
