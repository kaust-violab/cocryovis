// writes the display preset of ts16 scenes (<scene>.display.json in GV_SCENES) from jobs/ts16.mjs:
// published ramps, the four cameras, the original voxel data and the voxelisation of the fit,
// so that the viewer treats ts16 like any converted scene
//   node jobs/make_ts16_preset.mjs [scene ...]     (default: ts16_s2)
import fs from "node:fs";
import path from "node:path";
import { TS16_DIMS, TS16_URLS, TS16_RAMPS, CAMERAS } from "./ts16.mjs";

const SCENES = process.env.GV_SCENES ?? "scenes";
const names = process.argv.length > 2 ? process.argv.slice(2) : ["ts16_s2"];

for (const scene of names) {
  // the scene header gives the volume size and the channel names (Spikes, Membrane, Inner, Raw)
  const header = JSON.parse(fs.readFileSync(path.join(SCENES, `${scene}.json`), "utf8"));
  const v = header.volumeSize;
  // fit_lattice.py --voxelize writes <scene>_vox_<channel>.raw next to the scene
  const hasVoxels = fs.existsSync(path.join(SCENES, `${scene}_vox_${header.channels[0]}.raw`));
  const preset = {
    scene,
    dims: [v.x, v.y, v.z],
    channels: header.channels,
    numChannels: 4,
    rawVolumeChannel: 3,
    voxels: hasVoxels ? `${scene}_vox` : null,
    dataVolume: { urls: TS16_URLS, dims: TS16_DIMS }, // served under /data/ts16 by viewer.mjs
    ramps: { published: TS16_RAMPS },
    defaultRamps: "published",
    cameras: CAMERAS,
    defaultCamera: "whole",
  };
  const file = path.join(SCENES, `${scene}.display.json`);
  fs.writeFileSync(file, JSON.stringify(preset, null, 1));
  console.log(`wrote ${file}${hasVoxels ? "" : " (no voxelisation found)"}`);
}