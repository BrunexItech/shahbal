/**
 * Region colours shared by the in-app regions map and the GeoLibre project
 * (backend/app/modules/mapping/project.py). One fixed hue per constituency, assigned
 * alphabetically and never by rank; validated for colour-blind separation. Gold and
 * orange are low-contrast on white, so every constituency is always direct-labelled.
 */
export const CONSTITUENCY_COLORS: Record<string, string> = {
  Changamwe: "#0b7fa6",
  Jomvu: "#c9a227",
  Kisauni: "#006b3f",
  Likoni: "#bb1e10",
  Mvita: "#7b4fb8",
  Nyali: "#e07b39",
};

/** Progress to target, light → Kenyan green; the low end is split finely for early-campaign numbers. */
export const PROGRESS_STEPS: [number, string, string][] = [
  [0, "#e3f1e9", "<5%"],
  [5, "#bfe2cd", "5–9"],
  [10, "#8fcfaa", "10–24"],
  [25, "#57b482", "25–49"],
  [50, "#2a965f", "50–74"],
  [75, "#0f7a47", "75–99"],
  [100, "#00552f", "100%+"],
];
