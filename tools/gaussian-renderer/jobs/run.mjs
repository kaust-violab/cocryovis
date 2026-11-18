// General batch runner: node jobs/run.mjs <spec.json> [outDir]
// Environment: GV_TS16_DIR (ts_16 demo data), GV_SCENES (Gaussian scenes and their voxelisations), GV_OUT.
// spec = { size, defaults: {...RenderConfig}, renders: [{ name, volume?, scene?, camera, ...RenderConfig }] }
//   volume: "original" | "<scene>" (voxelisation of that Gaussian scene)   scene: Gaussian scene name
import fs from "node:fs";
import { openSession } from "../lib/session.mjs";
import { TS16_DIR, TS16_DIMS, TS16_URLS, TS16_RAMPS, CAMERAS } from "./ts16.mjs";

const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = process.argv[3] ?? process.env.GV_OUT ?? "out";
const SCENES = process.env.GV_SCENES ?? "scenes";
const s = await openSession({ mounts: { "/data/ts16": TS16_DIR, "/data/scenes": SCENES } });
let volume = null, scene = null;
const results = [];
for (const r of spec.renders) {
  const { name, volume: wantVolume, scene: wantScene, camera, ...rest } = r;
  if (wantVolume && wantVolume !== volume) {
    const urls = wantVolume === "original" ? TS16_URLS
      : (spec.channels ?? ["Spikes", "Membrane", "Inner", "Raw"]).map((c) => `/data/scenes/${wantVolume}_vox_${c}.raw`);
    await s.call("loadVoxelVolume", urls, spec.dims ?? TS16_DIMS);
    volume = wantVolume;
  }
  if (wantScene && wantScene !== scene) {
    const info = await s.call("loadGaussians", `/data/scenes/${wantScene}.json`);
    console.log("scene", wantScene, JSON.stringify(info));
    scene = wantScene;
  }
  const size = r.size ?? spec.size ?? 256;
  const config = {
    width: size, height: size, ramps: spec.ramps ?? TS16_RAMPS, numChannels: 4, rawVolumeChannel: 3,
    ...(spec.defaults ?? {}), ...rest,
    camera: typeof camera === "string" ? CAMERAS[camera] : camera,
    params: { ...(spec.defaults?.params ?? {}), ...(rest.params ?? {}) },
  };
  delete config.size;
  const res = await s.render(config, `${out}/${name}.png`);
  results.push({ name, ms: res.ms, extra: res.extra });
  console.log(name, res.ms.toFixed(0), "ms", res.extra ? JSON.stringify(res.extra) : "");
}
const errors = s.logs.filter((l) => /error|warning/i.test(l));
if (errors.length) console.log(errors.slice(0, 12).join("\n"));
fs.writeFileSync(`${out}/${spec.name ?? "results"}.timings.json`, JSON.stringify(results, null, 2));
await s.close();
