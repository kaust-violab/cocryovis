import {
  type DecodedBuffer,
  Float32,
  Float32Vec4,
  Uint32,
} from "buffer-backed-object";
import { WebGpuBufferBBO } from "@/renderer/core/webGpuBufferBBO";

/** Look of the volume shading. */
export const LookMode = {
  /** The CoCryoViS look (volume.fs.wgsl). */
  Fast: 0,
  /** Reference look after Nano-Oetzi (TVCG), Section 5.2. */
  Reference: 1,
} as const;

/** Where ambient occlusion and shadows are evaluated. */
export const LightingMode = {
  /** At every contributing ray sample. */
  PerSample: 0,
  /** Once per Gaussian, read back through the light cache. */
  Cached: 1,
} as const;

// Must match struct ExtParam in gv_common.wgsl (96 bytes).
const extParametersDescriptor = {
  lookMode: Uint32(),
  lightingMode: Uint32(),
  refAoSamples: Uint32(),
  refShadowSteps: Uint32(),

  refAoRadius: Float32(),
  refAoUpOffset: Float32(),
  refAoGain: Float32(),
  refAoWeight: Float32(),

  refLightRadius: Float32(),
  refShadowReach: Float32(),
  refShadowGain: Float32(),
  refShadowWeight: Float32(),

  /** Shadow tint (rgb) and brightness gain (a). */
  refTintGain: Float32Vec4(),

  refLightPosViewX: Float32(),
  refLightPosViewY: Float32(),
  refLightPosViewZ: Float32(),
  frameSeed: Uint32(),

  cacheRepeats: Uint32(),
  reserved0: Uint32(),
  reserved1: Uint32(),
  reserved2: Uint32(),
} as const;

export type ExtParameters = DecodedBuffer<typeof extParametersDescriptor>;

export class ExtParametersBuffer extends WebGpuBufferBBO<
  typeof extParametersDescriptor
> {
  /**
   * The reference constants are those of the Nano-Oetzi desktop shader:
   * occlusion sphere of radius 0.01 pushed up by two radii, 3 samples, gain
   * 10 (20 x 0.5) and tint weight 0.7; spherical light of radius 2.9 at
   * view-space (1, 1, 3), 50 shadow steps over a reach of 1, weight
   * (1 - t)^2, gain 1 / (0.7 * 0.02), tint weight 1.5; tint (0.15, 0.18,
   * 0.32) and brightness gain 1.15.
   */
  static readonly defaults: ExtParameters = {
    lookMode: LookMode.Fast,
    lightingMode: LightingMode.PerSample,
    refAoSamples: 3,
    refShadowSteps: 50,

    refAoRadius: 0.02,
    refAoUpOffset: 2.0,
    refAoGain: 10.0,
    refAoWeight: 0.7,

    refLightRadius: 2.9,
    refShadowReach: 1.0,
    refShadowGain: 1 / (0.7 * 0.02),
    refShadowWeight: 1.5,

    refTintGain: [0.15, 0.18, 0.32, 1.15],

    refLightPosViewX: 1.0,
    refLightPosViewY: 1.0,
    refLightPosViewZ: 3.0,
    frameSeed: 0,

    cacheRepeats: 4,
    reserved0: 0,
    reserved1: 0,
    reserved2: 0,
  } as const;

  constructor(device: GPUDevice, init?: Partial<ExtParameters>) {
    super(device, extParametersDescriptor, "Gaussian Ext Parameters Buffer", {
      align: 16,
    });

    this.set(ExtParametersBuffer.defaults);
    if (init !== undefined) {
      this.set(init);
    }
  }

  protected override createBuffer(size: number): GPUBuffer {
    return this.device.createBuffer({
      size: size,
      label: this.label,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }
}
