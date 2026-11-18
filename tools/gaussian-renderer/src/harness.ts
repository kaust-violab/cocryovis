/**
 * Headless test harness for the Gaussian volume pass.
 *
 * It instantiates the real CoCryoViS renderer classes (camera, parameter
 * buffers, transfer-function lookup, VolumePass) without the React client, so
 * that the original voxel renderer and the Gaussian renderers can be driven
 * with identical inputs and their images read back.
 */
import { vec3 } from "gl-matrix";
import { Camera } from "@/renderer/core/camera";
import {
  RenderingParametersBuffer,
  type RenderingParameters,
} from "@/renderer/renderingParametersBuffer";
import { VolumeParameterBuffer } from "@/renderer/volume/volumeParameterBuffer";
import { ChannelData } from "@/renderer/volume/channelData";
import { ClippingParametersBuffer } from "@/renderer/volume/clippingParametersBuffer";
import { AnnotationsDataBuffer } from "@/renderer/annotations/annotationsDataBuffer";
import { TransferFunctionLut } from "@/renderer/volume/transferFunctionLut";
import { VolumePass } from "@/renderer/volume/volumePass";
import type { BindableTexture } from "@/renderer/core/webGpuTexture";
import {
  ExtParametersBuffer,
  LightingMode,
  LookMode,
  type ExtParameters,
} from "@/renderer/gaussian/extParametersBuffer";
import { GaussianScene, type GaussianGridOptions } from "@/renderer/gaussian/gaussianScene";
import { GaussianVolumePass } from "@/renderer/gaussian/gaussianVolumePass";
import { GaussianSplatPass } from "@/renderer/gaussian/gaussianSplatPass";
import { BloomComposite, type BloomSettings } from "@/renderer/gaussian/bloomComposite";
import type { Framebuffer } from "@/renderer/core/framebuffer";

export interface CameraConfig {
  position: [number, number, number];
  viewCenter: [number, number, number];
  up: [number, number, number];
  fovY: number;
  near?: number;
  far?: number;
}

export interface RampConfig {
  /** Ramp start and end on the channel value in [0, 1]. */
  low: number;
  high: number;
  /** Colour as #rrggbb. */
  color: string;
}

export interface RenderConfig {
  /** "original": the unmodified VolumePass. "march": GaussianVolumePass. "splat": GaussianSplatPass. */
  renderer: "original" | "march" | "splat";
  /** Field of the "march" renderer. */
  field?: "voxel" | "gaussian";
  look?: "fast" | "reference";
  lighting?: "per-sample" | "cached";
  ext?: Partial<ExtParameters>;
  /** Splat renderer: sample points per Gaussian for the fit to the classified field (0 = plain splats). */
  refitSamples?: number;
  /** Adds the bloom post-process (true for the defaults). */
  bloom?: boolean | Partial<BloomSettings>;
  width: number;
  height: number;
  camera: CameraConfig;
  params?: Partial<RenderingParameters>;
  ramps: RampConfig[];
  rawVolumeChannel: number;
  numChannels: number;
  clearColor?: [number, number, number, number];
}

/** Caches the view so that BindGroup sees a stable resource. */
class CachedTexture implements BindableTexture {
  private readonly view: GPUTextureView;
  constructor(
    private readonly texture: GPUTexture,
    private readonly sampler?: GPUSampler,
    dimension: GPUTextureViewDimension = "3d"
  ) {
    this.view = texture.createView({ dimension });
  }
  getTexture() {
    return this.texture;
  }
  getView() {
    return this.view;
  }
  getSampler() {
    return this.sampler;
  }
}

function toHex2(v: number) {
  return Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, "0");
}

export class Harness {
  device!: GPUDevice;
  adapterInfo: Record<string, string> = {};

  camera!: Camera;
  renderingParameters!: RenderingParametersBuffer;
  volumeParameters!: VolumeParameterBuffer;
  channelData!: ChannelData;
  clipping!: ClippingParametersBuffer;
  annotations!: AnnotationsDataBuffer;
  tfLut!: TransferFunctionLut;
  extParameters!: ExtParametersBuffer;
  scene: GaussianScene | undefined;

  volumeSampler!: GPUSampler;
  volume: CachedTexture | undefined;
  annotationVolume!: CachedTexture;
  volumeDims: [number, number, number] = [1, 1, 1];

  async init() {
    if (!navigator.gpu) throw new Error("WebGPU is not available");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    const info = adapter.info;
    this.adapterInfo = {
      vendor: info?.vendor ?? "",
      architecture: info?.architecture ?? "",
      description: info?.description ?? "",
    };
    this.device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    this.device.addEventListener("uncapturederror", (e) => {
      console.error("WebGPU error:", (e as GPUUncapturedErrorEvent).error.message);
    });

    const d = this.device;
    this.camera = new Camera(d, {
      position: vec3.fromValues(0, 0, -3),
      viewCenter: vec3.fromValues(0, 0, 0),
      up: vec3.fromValues(0, 1, 0),
      fovY: 45,
      aspectRatio: 1,
      near: 0.01,
      far: 100,
    });
    this.renderingParameters = new RenderingParametersBuffer(d);
    this.volumeParameters = new VolumeParameterBuffer(d);
    this.channelData = new ChannelData(d);
    this.clipping = new ClippingParametersBuffer(d);
    this.annotations = new AnnotationsDataBuffer(d);
    this.tfLut = new TransferFunctionLut(d);
    this.extParameters = new ExtParametersBuffer(d);

    // Same sampler as VolumeManager creates.
    this.volumeSampler = d.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
    });

    const dummy = d.createTexture({
      label: "Annotation volume (empty)",
      format: "rgba8unorm",
      dimension: "3d",
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.annotationVolume = new CachedTexture(dummy);
    return this.adapterInfo;
  }

  /**
   * Loads up to four uint8 volumes (x fastest, then y, then z) and packs them
   * into the channels of one rgba8unorm 3D texture, as CoCryoViS does.
   */
  async loadVoxelVolume(urls: string[], dims: [number, number, number]) {
    const [nx, ny, nz] = dims;
    const n = nx * ny * nz;
    const packed = new Uint8Array(n * 4);
    for (let c = 0; c < Math.min(4, urls.length); c++) {
      const buf = new Uint8Array(await (await fetch(urls[c])).arrayBuffer());
      if (buf.length !== n) {
        throw new Error(`${urls[c]}: expected ${n} bytes, got ${buf.length}`);
      }
      for (let i = 0; i < n; i++) packed[i * 4 + c] = buf[i];
    }
    this.volume?.getTexture().destroy();
    const texture = this.device.createTexture({
      label: "Volume",
      format: "rgba8unorm",
      dimension: "3d",
      size: { width: nx, height: ny, depthOrArrayLayers: nz },
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    const slab = 32;
    for (let z0 = 0; z0 < nz; z0 += slab) {
      const depth = Math.min(slab, nz - z0);
      this.device.queue.writeTexture(
        { texture, origin: { x: 0, y: 0, z: z0 } },
        packed.subarray(z0 * nx * ny * 4, (z0 + depth) * nx * ny * 4),
        { bytesPerRow: nx * 4, rowsPerImage: ny },
        { width: nx, height: ny, depthOrArrayLayers: depth }
      );
    }
    this.volume = new CachedTexture(texture, this.volumeSampler);
    this.volumeDims = dims;
    const maxSize = Math.max(nx, ny, nz);
    this.volumeParameters.set({
      ratio: [nx / maxSize, ny / maxSize, nz / maxSize, 1],
    });
    return { voxels: n };
  }

  /** Loads a Gaussian scene and builds its grid; returns grid statistics. */
  async loadGaussians(headerUrl: string, gridOptions?: GaussianGridOptions) {
    const t0 = performance.now();
    this.scene?.destroy();
    this.scene = await GaussianScene.load(this.device, headerUrl, gridOptions);
    const size = this.scene.header.volumeSize;
    const maxSize = Math.max(size.x, size.y, size.z);
    this.volumeParameters.set({
      ratio: [size.x / maxSize, size.y / maxSize, size.z / maxSize, 1],
    });
    return {
      count: this.scene.count,
      gridDims: this.scene.grid.dims,
      gridEntries: this.scene.grid.indices.length,
      maxPerCell: this.scene.grid.maxPerCell,
      meanPerOccupiedCell: this.scene.grid.meanPerOccupiedCell,
      ms: performance.now() - t0,
    };
  }

  private get managers() {
    return {
      volumeManager: {
        volume: this.volume ?? { getSampler: () => this.volumeSampler, getView: () => undefined, getTexture: () => undefined },
        transferFunctionLut: this.tfLut,
        volumeParameterBuffer: this.volumeParameters,
        channelData: this.channelData,
      } as never,
      annotationManager: {
        getAnnotationVolume: () => this.annotationVolume,
        annotationsDataBuffer: this.annotations,
      } as never,
      clippingPlaneManager: { clippingParametersBuffer: this.clipping } as never,
    };
  }

  private applyCommon(config: RenderConfig) {
    const c = config.camera;
    this.camera.setParameters({
      position: vec3.fromValues(...c.position),
      viewCenter: vec3.fromValues(...c.viewCenter),
      up: vec3.fromValues(...c.up),
      fovY: c.fovY,
      near: c.near ?? 0.01,
      far: c.far ?? 100,
      aspectRatio: config.width / config.height,
    });
    this.renderingParameters.set(RenderingParametersBuffer.defaults);
    if (config.params) this.renderingParameters.set(config.params);
    this.volumeParameters.set({
      numChannels: config.numChannels,
      rawVolumeChannel: config.rawVolumeChannel,
      rawClippingPlane: false,
      voxelSize: 1,
    });
    for (let i = 0; i < 4; i++) {
      this.channelData.set(i, { visible: i < config.numChannels, clipVisible: true });
    }
    this.extParameters.set(ExtParametersBuffer.defaults);
    this.extParameters.set({
      lookMode: config.look === "reference" ? LookMode.Reference : LookMode.Fast,
      lightingMode: config.lighting === "cached" ? LightingMode.Cached : LightingMode.PerSample,
    });
    if (config.ext) this.extParameters.set(config.ext);
    config.ramps.forEach((ramp, channel) => {
      // Constant colour with an alpha ramp, as in the Nano-Oetzi transfer functions.
      const rgb = ramp.color.slice(0, 7);
      this.tfLut.setBreakpoints(channel, [
        { position: ramp.low, color: rgb + toHex2(0) },
        { position: ramp.high, color: rgb + toHex2(255) },
      ]);
    });
  }

  private async readback(texture: GPUTexture, width: number, height: number) {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height }
    );
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    }
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  /** Reads the pass framebuffer back, through the bloom composite if requested. */
  private async finish(framebuffer: Framebuffer, config: RenderConfig) {
    if (!config.bloom) {
      return this.readback(framebuffer.getColorTexture(), config.width, config.height);
    }
    const bloom = new BloomComposite(this.device, "rgba8unorm", framebuffer);
    if (typeof config.bloom === "object") Object.assign(bloom.settings, config.bloom);
    const target = this.device.createTexture({
      format: "rgba8unorm",
      size: { width: config.width, height: config.height },
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const encoder = this.device.createCommandEncoder();
    bloom.prepare(encoder);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" },
      ],
    });
    bloom.render(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    const pixels = await this.readback(target, config.width, config.height);
    bloom.destroy();
    target.destroy();
    return pixels;
  }

  async render(config: RenderConfig) {
    this.applyCommon(config);
    const clear = config.clearColor ?? [0, 0, 0, 1];
    const t0 = performance.now();
    let pixels: Uint8Array;
    let extra: Record<string, number> | undefined;

    if (config.renderer === "march") {
      const kind = config.field ?? "voxel";
      if (kind === "voxel" && !this.volume) throw new Error("No voxel volume loaded");
      if (kind === "gaussian" && !this.scene) throw new Error("No Gaussian scene loaded");
      const pass = new GaussianVolumePass({
        device: this.device,
        width: config.width,
        height: config.height,
        format: "rgba8unorm",
        camera: this.camera,
        ...this.managers,
        renderingParameters: this.renderingParameters,
        extParameters: this.extParameters,
        field: kind === "gaussian" ? { kind, scene: this.scene! } : { kind: "voxel" },
      });
      const encoder = this.device.createCommandEncoder();
      if (config.lighting === "cached") pass.updateLightCache(encoder);
      pass.render(encoder, clear);
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      pixels = await this.finish(pass.framebuffer, config);
      pass.destroy();
    } else if (config.renderer === "splat") {
      if (!this.scene) throw new Error("No Gaussian scene loaded");
      const pass = new GaussianSplatPass({
        device: this.device,
        width: config.width,
        height: config.height,
        format: "rgba8unorm",
        camera: this.camera,
        ...this.managers,
        renderingParameters: this.renderingParameters,
        extParameters: this.extParameters,
        scene: this.scene,
        options: { refitSamples: config.refitSamples },
      });
      const tClassify = performance.now();
      let encoder = this.device.createCommandEncoder();
      pass.classify(encoder);
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      const tLight = performance.now();
      encoder = this.device.createCommandEncoder();
      pass.light(encoder);
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      const tSort = performance.now();
      pass.sort();
      const tDraw = performance.now();
      encoder = this.device.createCommandEncoder();
      pass.render(encoder, clear);
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      extra = { classifyMs: tLight - tClassify, lightMs: tSort - tLight, sortMs: tDraw - tSort, drawMs: performance.now() - tDraw };
      pixels = await this.finish(pass.framebuffer, config);
      pass.destroy();
    } else if (config.renderer === "original") {
      if (!this.volume) throw new Error("No voxel volume loaded");
      // The unmodified CoCryoViS volume pass, wired the way VolumeRenderer wires it.
      const pass = new VolumePass({
        device: this.device,
        width: config.width,
        height: config.height,
        format: "rgba8unorm",
        camera: this.camera,
        volumeManager: {
          volume: this.volume,
          transferFunctionLut: this.tfLut,
          volumeParameterBuffer: this.volumeParameters,
          channelData: this.channelData,
        } as never,
        annotationManager: {
          getAnnotationVolume: () => this.annotationVolume,
          annotationsDataBuffer: this.annotations,
        } as never,
        renderingParameters: this.renderingParameters,
        clippingPlaneManager: { clippingParametersBuffer: this.clipping } as never,
      });
      const encoder = this.device.createCommandEncoder();
      pass.render(encoder, clear);
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      pixels = await this.finish(pass.framebuffer, config);
      pass.destroy();
    } else {
      throw new Error(`Unknown renderer ${String(config.renderer)}`);
    }
    const ms = performance.now() - t0;
    return { width: config.width, height: config.height, ms, extra, pixels: bytesToBase64(pixels) };
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

(globalThis as unknown as { gv: Harness }).gv = new Harness();
