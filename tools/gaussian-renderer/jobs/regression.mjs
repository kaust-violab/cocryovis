// Regression test: GaussianVolumePass with the voxel field must reproduce VolumePass exactly.
//   node jobs/regression.mjs [outDir] [size]
import fs from "node:fs";
import { openSession } from "../lib/session.mjs";
import { TS16_DIR, TS16_DIMS, TS16_URLS, TS16_RAMPS, CAMERAS } from "./ts16.mjs";

const out = process.argv[2] ?? process.env.GV_OUT ?? "out";
const size = Number(process.argv[3] ?? 192);
const s = await openSession({ mounts: { "/data/ts16": TS16_DIR } });
await s.call("loadVoxelVolume", TS16_URLS, TS16_DIMS);
const base = { width: size, height: size, ramps: TS16_RAMPS, numChannels: 4, rawVolumeChannel: 3 };
let failed = false;
for (const cam of ["close", "whole"]) {
  for (const jitter of [true, false]) {
    const params = { enableJittering: jitter };
    const tag = `${cam}_${jitter ? "jitter" : "nojitter"}_${size}`;
    const a = `${out}/regression_original_${tag}.png`;
    const b = `${out}/regression_march_voxel_${tag}.png`;
    await s.render({ ...base, renderer: "original", camera: CAMERAS[cam], params }, a);
    await s.render({ ...base, renderer: "march", field: "voxel", look: "fast", camera: CAMERAS[cam], params }, b);
    const same = fs.readFileSync(a).equals(fs.readFileSync(b));
    console.log(tag, same ? "identical" : "DIFFERENT");
    failed ||= !same;
  }
}
await s.close();
process.exit(failed ? 1 : 0);
