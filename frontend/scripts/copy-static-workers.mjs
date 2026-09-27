// Browser workers that must be served as static files from our own origin, copied from the
// installed packages so the versions always match (nothing loads from third-party CDNs):
// - MapLibre 6 parses map tiles in an ES-module Web Worker.
// - The "Talk to Shahbal" voice test (ElevenLabs) processes microphone and speaker audio in AudioWorklets.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copy = (fromDir, toDir, files) => {
  mkdirSync(join(root, toDir), { recursive: true });
  for (const f of files) copyFileSync(join(root, fromDir, f), join(root, toDir, f));
};
copy("node_modules/maplibre-gl/dist", "public/maplibre", ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);
copy("node_modules/@elevenlabs/client/worklets", "public/elevenlabs", ["rawAudioProcessor.js", "audioConcatProcessor.js"]);
copy("node_modules/@alexanderolsen/libsamplerate-js/dist", "public/elevenlabs", ["libsamplerate.worklet.js"]);
console.log("workers copied → public/maplibre, public/elevenlabs");
