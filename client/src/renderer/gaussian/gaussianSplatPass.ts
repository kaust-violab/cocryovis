import fullscreenVertexShader from "@/assets/shaders/fullscreen.vs.wgsl?raw";
import gvCommon from "@/assets/shaders/gaussian/gv_common.wgsl?raw";
import gvFieldGauss from "@/assets/shaders/gaussian/gv_field_gauss.wgsl?raw";
import gvLighting from "@/assets/shaders/gaussian/gv_lighting.wgsl?raw";
import gvClassify from "@/assets/shaders/gaussian/gv_splat_classify.comp.wgsl?raw";
import gvSplatLight from "@/assets/shaders/gaussian/gv_splat_light.comp.wgsl?raw";
import gvSplat from "@/assets/shaders/gaussian/gv_splat.wgsl?raw";
import gvResolve from "@/assets/shaders/gaussian/gv_splat_resolve.fs.wgsl?raw";

import { BindGroup } from "../core/bindGroup";
import type { Camera } from "../core/camera";
import { Framebuffer } from "../core/framebuffer";
import { DEPTH_TEXTURE_FORMAT } from "../core/defines";
import type { RenderingParametersBuffer } from "../renderingParametersBuffer";
import type { VolumeManager } from "../volume/volumeManager";
import {
  computeGroup0Layout,
  setSharedResources,
  type GaussianSharedInputs,
} from "./gaussianLightCache";
import { FLOATS_PER_GAUSSIAN_GPU, type GaussianScene } from "./gaussianScene";

const ACCUMULATION_FORMAT: GPUTextureFormat = "rgba16float";

const MAX_REFIT_SAMPLES = 32;

/**
 * Deterministic sample points with a standard normal distribution: zero mean
 * and unit covariance exactly, no point further out than 2.8.
 */
function standardNormalSamples(count: number): Float32Array {
  let state = 0x9e3779b9;
  const random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const points: number[][] = [];
  while (points.length < count) {
    const p = [0, 0, 0].map(() => {
      const u = Math.max(random(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    });
    if (Math.hypot(p[0], p[1], p[2]) < 2.8) points.push(p);
  }
  // whiten: subtract the mean, then apply the inverse Cholesky factor of the covariance
  const mean = [0, 1, 2].map(
    (a) => points.reduce((s, p) => s + p[a], 0) / count
  );
  for (const p of points) for (let a = 0; a < 3; a++) p[a] -= mean[a];
  const cov = (a: number, b: number) =>
    points.reduce((s, p) => s + p[a] * p[b], 0) / count;
  const l00 = Math.sqrt(cov(0, 0));
  const l10 = cov(0, 1) / l00;
  const l20 = cov(0, 2) / l00;
  const l11 = Math.sqrt(cov(1, 1) - l10 * l10);
  const l21 = (cov(1, 2) - l20 * l10) / l11;
  const l22 = Math.sqrt(cov(2, 2) - l20 * l20 - l21 * l21);
  const out = new Float32Array(count * 4);
  points.forEach((p, i) => {
    // solve L y = p
    const y0 = p[0] / l00;
    const y1 = (p[1] - l10 * y0) / l11;
    const y2 = (p[2] - l20 * y0 - l21 * y1) / l22;
    out.set([y0, y1, y2, 0], i * 4);
  });
  return out;
}

export interface GaussianSplatOptions {
  /**
   * Sample points per Gaussian for the fit to the classified field (at most
   * 32). 0 keeps every Gaussian as it is and classifies it at its centre.
   */
  refitSamples?: number;
  /** Share of the original covariance kept in the fitted one. */
  covarianceFloor?: number;
}

/**
 * Pure-splatting variant of the Gaussian volume renderer.
 *
 * (1) classify(): every Gaussian is re-fitted to its share of the classified
 * field. Depends on the transfer functions, channel visibility and clipping
 * plane, not on the camera. (2) light(): ambient occlusion and shadow per
 * visible splat. Depends on the camera too, because the light follows it.
 * (3) sort(): depth sort on the CPU, when the camera moved. (4) render():
 * front-to-back alpha blending of screen-space splats, then a resolve into the
 * pass framebuffer with the conventions of VolumePass.
 */
export class GaussianSplatPass {
  private readonly device: GPUDevice;
  private readonly camera: Camera;
  private readonly volumeManager: VolumeManager;
  private readonly renderingParameters: RenderingParametersBuffer;
  private readonly scene: GaussianScene;
  readonly framebuffer: Framebuffer;

  private readonly lightBindGroup: BindGroup;
  private readonly lightSceneBindGroup: GPUBindGroup;
  private readonly lightPipeline: GPUComputePipeline;

  private readonly geometryBuffer: GPUBuffer;
  private readonly classifyParamsBuffer: GPUBuffer;
  private readonly refitSamples: number;
  private readonly covarianceFloor: number;

  private readonly classifyBindGroup: BindGroup;
  private readonly classifySceneBindGroup: GPUBindGroup;
  private readonly classifyPipeline: GPUComputePipeline;

  private readonly splatBindGroup: BindGroup;
  private readonly splatSceneBindGroup: GPUBindGroup;
  private readonly splatPipeline: GPURenderPipeline;

  private readonly resolveLayout: GPUBindGroupLayout;
  private resolveBindGroup: GPUBindGroup | undefined;
  private readonly resolvePipeline: GPURenderPipeline;

  private readonly splatAttrBuffer: GPUBuffer;
  private readonly orderBuffer: GPUBuffer;
  private readonly splatParamsBuffer: GPUBuffer;
  private readonly resolveParamsBuffer: GPUBuffer;
  private accumulation: GPUTexture;
  private accumulationView: GPUTextureView;

  private width: number;
  private height: number;

  // CPU side of the depth sort
  private readonly worldPositions: Float32Array;
  private readonly order: Uint32Array;
  private readonly keys: Uint16Array;
  private readonly bucketCounts = new Uint32Array(65536);
  private worldRatio: [number, number, number] | undefined;

  constructor({
    width,
    height,
    format,
    scene,
    options,
    ...inputs
  }: GaussianSharedInputs & {
    width: number;
    height: number;
    format: GPUTextureFormat;
    scene: GaussianScene;
    options?: GaussianSplatOptions;
  }) {
    const device = inputs.device;
    this.device = device;
    this.camera = inputs.camera;
    this.volumeManager = inputs.volumeManager;
    this.renderingParameters = inputs.renderingParameters;
    this.scene = scene;
    this.width = width;
    this.height = height;

    this.framebuffer = new Framebuffer({
      device,
      width,
      height,
      colorFormat: format,
      depthFormat: DEPTH_TEXTURE_FORMAT,
    });
    this.refitSamples = Math.min(
      MAX_REFIT_SAMPLES,
      Math.max(0, Math.round(options?.refitSamples ?? MAX_REFIT_SAMPLES))
    );
    this.covarianceFloor = options?.covarianceFloor ?? 0.05;

    const n = Math.max(scene.count, 1);
    this.geometryBuffer = device.createBuffer({
      label: "Gaussian splat geometry",
      size: n * 64,
      usage: GPUBufferUsage.STORAGE,
    });
    // struct SplatClassifyParams: 16 bytes of scalars and 32 sample points
    const classifyParams = new ArrayBuffer(16 + MAX_REFIT_SAMPLES * 16);
    new Uint32Array(classifyParams, 0, 1)[0] = this.refitSamples;
    new Float32Array(classifyParams, 4, 1)[0] = this.covarianceFloor;
    if (this.refitSamples > 0) {
      new Float32Array(classifyParams, 16, this.refitSamples * 4).set(
        standardNormalSamples(this.refitSamples)
      );
    }
    this.classifyParamsBuffer = device.createBuffer({
      label: "Gaussian splat classification parameters",
      size: classifyParams.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.classifyParamsBuffer, 0, classifyParams);
    this.splatAttrBuffer = device.createBuffer({
      label: "Gaussian splat attributes",
      size: n * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this.orderBuffer = device.createBuffer({
      label: "Gaussian splat order",
      size: n * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.splatParamsBuffer = device.createBuffer({
      label: "Gaussian splat parameters",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.resolveParamsBuffer = device.createBuffer({
      label: "Gaussian splat resolve parameters",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.worldPositions = new Float32Array(n * 3);
    this.order = new Uint32Array(n);
    this.keys = new Uint16Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    device.queue.writeBuffer(
      this.orderBuffer,
      0,
      this.order.buffer,
      this.order.byteOffset,
      this.order.byteLength
    );

    ({ texture: this.accumulation, view: this.accumulationView } =
      this.createAccumulation());

    // ---- classification (compute) ----
    this.classifyBindGroup = new BindGroup(device, computeGroup0Layout());
    setSharedResources(this.classifyBindGroup, inputs);
    const c = GPUShaderStage.COMPUTE;
    const classifySceneLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: c, buffer: { type: "uniform" } },
        { binding: 1, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: c, buffer: { type: "storage" } },
        { binding: 6, visibility: c, buffer: { type: "uniform" } },
      ],
    });
    this.classifySceneBindGroup = device.createBindGroup({
      layout: classifySceneLayout,
      entries: [
        { binding: 0, resource: { buffer: scene.gridUniform } },
        { binding: 1, resource: { buffer: scene.gaussianBuffer } },
        { binding: 2, resource: { buffer: scene.cellBuffer } },
        { binding: 3, resource: { buffer: scene.indexBuffer } },
        { binding: 5, resource: { buffer: this.geometryBuffer } },
        { binding: 6, resource: { buffer: this.classifyParamsBuffer } },
      ],
    });
    this.classifyPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [
          this.classifyBindGroup.getBindGroupLayout(),
          classifySceneLayout,
        ],
      }),
      compute: {
        module: device.createShaderModule({
          label: "Gaussian Splat Classification Compute Shader",
          code: [gvCommon, gvFieldGauss, gvLighting, gvClassify].join("\n"),
        }),
        entryPoint: "main",
      },
    });

    // ---- lighting per splat (compute) ----
    this.lightBindGroup = new BindGroup(device, computeGroup0Layout());
    setSharedResources(this.lightBindGroup, inputs);
    const lightSceneLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: c, buffer: { type: "uniform" } },
        { binding: 1, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: c, buffer: { type: "storage" } },
      ],
    });
    this.lightSceneBindGroup = device.createBindGroup({
      layout: lightSceneLayout,
      entries: [
        { binding: 0, resource: { buffer: scene.gridUniform } },
        { binding: 1, resource: { buffer: scene.gaussianBuffer } },
        { binding: 2, resource: { buffer: scene.cellBuffer } },
        { binding: 3, resource: { buffer: scene.indexBuffer } },
        { binding: 5, resource: { buffer: this.geometryBuffer } },
        { binding: 6, resource: { buffer: this.splatAttrBuffer } },
      ],
    });
    this.lightPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [
          this.lightBindGroup.getBindGroupLayout(),
          lightSceneLayout,
        ],
      }),
      compute: {
        module: device.createShaderModule({
          label: "Gaussian Splat Lighting Compute Shader",
          code: [gvCommon, gvFieldGauss, gvLighting, gvSplatLight].join("\n"),
        }),
        entryPoint: "main",
      },
    });

    // ---- splats (render) ----
    const v = GPUShaderStage.VERTEX;
    this.splatBindGroup = new BindGroup(device, {
      entries: [
        { binding: 0, visibility: v, buffer: { type: "uniform" } },
        { binding: 7, visibility: v, buffer: { type: "uniform" } },
      ],
    });
    this.splatBindGroup.setResource(0, inputs.camera);
    this.splatBindGroup.setResource(
      7,
      inputs.volumeManager.volumeParameterBuffer
    );
    const splatSceneLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: v | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 1, visibility: v, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: v, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: v, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: v, buffer: { type: "uniform" } },
      ],
    });
    this.splatSceneBindGroup = device.createBindGroup({
      layout: splatSceneLayout,
      entries: [
        { binding: 0, resource: { buffer: scene.gridUniform } },
        { binding: 1, resource: { buffer: this.geometryBuffer } },
        { binding: 2, resource: { buffer: this.splatAttrBuffer } },
        { binding: 3, resource: { buffer: this.orderBuffer } },
        { binding: 4, resource: { buffer: this.splatParamsBuffer } },
      ],
    });
    const splatModule = device.createShaderModule({
      label: "Gaussian Splat Shader",
      code: gvSplat,
    });
    this.splatPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [
          this.splatBindGroup.getBindGroupLayout(),
          splatSceneLayout,
        ],
      }),
      vertex: { module: splatModule, entryPoint: "vs" },
      fragment: {
        module: splatModule,
        entryPoint: "fs",
        targets: [
          {
            format: ACCUMULATION_FORMAT,
            // front-to-back "under" blending of premultiplied colour
            blend: {
              color: {
                srcFactor: "one-minus-dst-alpha",
                dstFactor: "one",
                operation: "add",
              },
              alpha: {
                srcFactor: "one-minus-dst-alpha",
                dstFactor: "one",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });

    // ---- resolve (render) ----
    this.resolveLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.resolvePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.resolveLayout],
      }),
      vertex: {
        module: device.createShaderModule({
          label: "Fullscreen Vertex Shader",
          code: fullscreenVertexShader,
        }),
        entryPoint: "main",
      },
      fragment: {
        module: device.createShaderModule({
          label: "Gaussian Splat Resolve Shader",
          code: gvResolve,
        }),
        entryPoint: "main",
        targets: [
          {
            format,
            // same blending as VolumePass
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: "always",
        format: DEPTH_TEXTURE_FORMAT,
      },
    });
  }

  private createAccumulation() {
    const texture = this.device.createTexture({
      label: "Gaussian splat accumulation",
      format: ACCUMULATION_FORMAT,
      size: { width: this.width, height: this.height },
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.resolveBindGroup = undefined;
    return { texture, view: texture.createView() };
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.framebuffer.resize(width, height);
    this.accumulation.destroy();
    ({ texture: this.accumulation, view: this.accumulationView } =
      this.createAccumulation());
  }

  /**
   * Re-fits every Gaussian to the classified field. Needed after a transfer
   * function, the channel visibility or the clipping plane changed.
   */
  classify(encoder: GPUCommandEncoder) {
    const group = this.classifyBindGroup.getGPUBindGroup();
    if (!group) return;
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.classifyPipeline);
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, this.classifySceneBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.scene.count / 64));
    pass.end();
  }

  /**
   * Lights every visible splat. Needed after classify() and after the camera
   * or a lighting parameter changed.
   */
  light(encoder: GPUCommandEncoder) {
    const group = this.lightBindGroup.getGPUBindGroup();
    if (!group) return;
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.lightPipeline);
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, this.lightSceneBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.scene.count / 64));
    pass.end();
  }

  /** Sorts the Gaussians by view depth, nearest first (16-bit counting sort). */
  sort() {
    const n = this.scene.count;
    if (n === 0) return;
    const ratio = this.volumeManager.volumeParameterBuffer.params.ratio;
    const rx = ratio[0];
    const ry = ratio[1];
    const rz = ratio[2];
    if (
      !this.worldRatio ||
      this.worldRatio[0] !== rx ||
      this.worldRatio[1] !== ry ||
      this.worldRatio[2] !== rz
    ) {
      const gpu = this.scene.packed.gpu;
      for (let i = 0; i < n; i++) {
        const o = i * FLOATS_PER_GAUSSIAN_GPU;
        this.worldPositions[i * 3] = (gpu[o] - 0.5) * 2 * rx;
        this.worldPositions[i * 3 + 1] = (gpu[o + 1] - 0.5) * 2 * ry;
        this.worldPositions[i * 3 + 2] = (gpu[o + 2] - 0.5) * 2 * rz;
      }
      this.worldRatio = [rx, ry, rz];
    }
    const view = this.camera.getViewMatrix().viewMatrix;
    // depth = -(row 2 of the view matrix applied to the position)
    const a = -view[2];
    const b = -view[6];
    const c = -view[10];
    const d = -view[14];
    const p = this.worldPositions;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const depth = a * p[i * 3] + b * p[i * 3 + 1] + c * p[i * 3 + 2] + d;
      if (depth < min) min = depth;
      if (depth > max) max = depth;
    }
    const scale = max > min ? 65535 / (max - min) : 0;
    const counts = this.bucketCounts;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const depth = a * p[i * 3] + b * p[i * 3 + 1] + c * p[i * 3 + 2] + d;
      const key = ((depth - min) * scale) | 0;
      this.keys[i] = key;
      counts[key]++;
    }
    let running = 0;
    for (let k = 0; k < 65536; k++) {
      const count = counts[k];
      counts[k] = running;
      running += count;
    }
    for (let i = 0; i < n; i++) {
      this.order[counts[this.keys[i]]++] = i;
    }
    this.device.queue.writeBuffer(
      this.orderBuffer,
      0,
      this.order.buffer,
      this.order.byteOffset,
      n * 4
    );
  }

  render(encoder: GPUCommandEncoder, clearColor: GPUColor) {
    this.device.queue.writeBuffer(
      this.splatParamsBuffer,
      0,
      new Float32Array([this.width, this.height, 0, 0])
    );
    // The marcher stops at the first sample whose coverage passes 0.8. With a
    // typical opacity per step of 0.5 * step / 0.0025 it overshoots by half of
    // one step's share of the remaining 0.2 on average.
    const stepSize = 0.01 / this.renderingParameters.params.sampleRate;
    const stepAlpha = Math.min(1, (0.5 * stepSize) / 0.0025);
    const resolveParams = new ArrayBuffer(16);
    new Uint32Array(resolveParams, 0, 1)[0] = this.renderingParameters.params
      .enableEarlyRayTermination
      ? 1
      : 0;
    new Float32Array(resolveParams, 4, 1)[0] = 0.8 + 0.2 * 0.5 * stepAlpha;
    this.device.queue.writeBuffer(this.resolveParamsBuffer, 0, resolveParams);

    const splatGroup = this.splatBindGroup.getGPUBindGroup();
    const splats = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.accumulationView,
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    if (splatGroup && this.scene.count > 0) {
      splats.setPipeline(this.splatPipeline);
      splats.setBindGroup(0, splatGroup);
      splats.setBindGroup(1, this.splatSceneBindGroup);
      splats.draw(6, this.scene.count);
    }
    splats.end();

    this.resolveBindGroup ??= this.device.createBindGroup({
      layout: this.resolveLayout,
      entries: [
        { binding: 0, resource: this.accumulationView },
        { binding: 1, resource: { buffer: this.resolveParamsBuffer } },
      ],
    });
    const resolve = encoder.beginRenderPass(
      this.framebuffer.getRenderPassDescriptor(clearColor)
    );
    resolve.setPipeline(this.resolvePipeline);
    resolve.setBindGroup(0, this.resolveBindGroup);
    resolve.draw(3);
    resolve.end();
  }

  destroy() {
    this.framebuffer.destroy();
    this.accumulation.destroy();
    this.splatAttrBuffer.destroy();
    this.geometryBuffer.destroy();
    this.classifyParamsBuffer.destroy();
    this.orderBuffer.destroy();
    this.splatParamsBuffer.destroy();
    this.resolveParamsBuffer.destroy();
  }
}
