// display presets: everything the viewer needs to show one scene. convert_cryosharp.py writes them for
// converted scenes and jobs/make_ts16_preset.mjs for ts16; jobs/viewer.mjs reads every
// <scene>.display.json in GV_SCENES and puts them on the page before it loads

import type { CameraConfig, RampConfig, RenderConfig } from "./harness";

export interface DisplayPreset {
  scene: string; // scene header: /data/scenes/<scene>.json
  dims: [number, number, number]; // volume size in voxels
  channels: string[]; // channel names, also the names of the voxel files
  numChannels: number;
  rawVolumeChannel: number; // -1 = no raw channel
  voxels: string | null; // prefix of the voxelisation of the Gaussians, if it exists
  dataVolume?: { urls: string[]; dims: [number, number, number] }; // original voxel data, if any
  ramps: Record<string, RampConfig[]>; // ramp options, one ramp per channel
  defaultRamps: string;
  cameras: Record<string, CameraConfig>;
  defaultCamera: string;
}

// the presets jobs/viewer.mjs put on the page (empty if the page was opened some other way)
export function loadPresets(): DisplayPreset[] {
  return (globalThis as unknown as { GV_PRESETS?: DisplayPreset[] }).GV_PRESETS ?? [];
}

// render configuration for one scene: marched Gaussians with the preset's default ramps and camera
export function configFromPreset(p: DisplayPreset, look: "fast" | "reference", size: number): RenderConfig {
  return {
    renderer: "march",
    field: "gaussian",
    look,
    width: size,
    height: size,
    camera: p.cameras[p.defaultCamera],
    ramps: p.ramps[p.defaultRamps],
    numChannels: p.numChannels,
    rawVolumeChannel: p.rawVolumeChannel,
  };
}