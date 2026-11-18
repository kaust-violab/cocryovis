// Shared description of the ts_16 SARS-CoV-2 demo scene (Nano-Oetzi WebGPU demo data).
// Directory data/ts_16_256 of github.com/kaust-violab/nano-oetzi-webgpu
export const TS16_DIR = process.env.GV_TS16_DIR ?? "data/ts_16_256";
export const TS16_DIMS = [256, 256, 448];
export const TS16_URLS = [
  "/data/ts16/ts_16_predictions-Spikes-256x256.raw",
  "/data/ts16/ts_16_predictions-Membrane-256x256.raw",
  "/data/ts16/ts_16_predictions-Inner-256x256.raw",
  "/data/ts16/ts_16_bin4-uint8-inv-mean-3-256x256.raw",
];
// Published ramps and colours (tf-spike.json, tf-memb.json, tf-in.json); channel 3 is the raw tomogram.
export const TS16_RAMPS = [
  { low: 0.1, high: 0.15, color: "#cf1f61" },
  { low: 0.1, high: 0.15, color: "#c79aab" },
  { low: 0.2, high: 0.25, color: "#223378" },
  { low: 0.0, high: 1.0, color: "#ffffff" },
];
export const CAMERAS = {
  front: { position: [0, 0, -3], viewCenter: [0, 0, 0], up: [0, 1, 0], fovY: 45 },
  side: { position: [2.6, 0.9, -1.2], viewCenter: [0, 0, 0], up: [0, 1, 0], fovY: 45 },
  close: { position: [0.9, 0.35, -1.25], viewCenter: [0.05, 0.0, 0.1], up: [0, 1, 0], fovY: 40 },
  whole: { position: [0.25, 0.5, -1.9], viewCenter: [0, 0, 0.05], up: [0, 1, 0], fovY: 45 },
};
