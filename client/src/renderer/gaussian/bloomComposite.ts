import fullscreenVertexShader from "@/assets/shaders/fullscreen.vs.wgsl?raw";
import bloomBlurShader from "@/assets/shaders/gaussian/gv_bloom_blur.fs.wgsl?raw";
import bloomCompositeShader from "@/assets/shaders/gaussian/gv_bloom_composite.fs.wgsl?raw";

import type { Framebuffer } from "../core/framebuffer";

export interface BloomSettings {
  /** Mean brightness below which a pixel does not bloom. */
  threshold: number;
  /** Blur extent as a fraction of the longer image side (Nano-Oetzi: 20 / 1280). */
  radius: number;
  /** Weight of the blurred image in the sum. */
  strength: number;
}

const BLOOM_FORMAT: GPUTextureFormat = "rgba16float";

/**
 * Drop-in alternative to FullscreenComposite that adds bloom: bright pass,
 * separable Gaussian blur, and addition onto the image. Call prepare() before
 * the final render pass and render() inside it.
 */
export class BloomComposite {
  /**
   * The radius is the one of the Nano-Oetzi WebGPU post chain. Its threshold
   * (0.2) and weight (1.25) overexpose the reference look, and the settings of
   * the published figures are not known, so the defaults give a subtle glow.
   */
  static readonly defaults: BloomSettings = {
    threshold: 0.4,
    radius: 20 / 1280,
    strength: 0.3,
  };

  settings: BloomSettings = { ...BloomComposite.defaults };

  private readonly device: GPUDevice;
  private readonly input: Framebuffer;
  private readonly sampler: GPUSampler;
  private readonly blurPipeline: GPURenderPipeline;
  private readonly compositePipeline: GPURenderPipeline;
  private readonly blurLayout: GPUBindGroupLayout;
  private readonly compositeLayout: GPUBindGroupLayout;
  private readonly paramsX: GPUBuffer;
  private readonly paramsY: GPUBuffer;
  private targets:
    { a: GPUTexture; b: GPUTexture; width: number; height: number } | undefined;

  constructor(device: GPUDevice, format: GPUTextureFormat, input: Framebuffer) {
    this.device = device;
    this.input = input;
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const f = GPUShaderStage.FRAGMENT;
    this.blurLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: f, sampler: { type: "filtering" } },
        {
          binding: 1,
          visibility: f,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        { binding: 2, visibility: f, buffer: { type: "uniform" } },
      ],
    });
    this.compositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: f, sampler: { type: "filtering" } },
        {
          binding: 1,
          visibility: f,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        { binding: 2, visibility: f, buffer: { type: "uniform" } },
        {
          binding: 3,
          visibility: f,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
      ],
    });
    const vertex = {
      module: device.createShaderModule({
        label: "Fullscreen Vertex Shader",
        code: fullscreenVertexShader,
      }),
      entryPoint: "main",
    };
    this.blurPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.blurLayout],
      }),
      vertex,
      fragment: {
        module: device.createShaderModule({
          label: "Bloom Blur Shader",
          code: bloomBlurShader,
        }),
        entryPoint: "main",
        targets: [{ format: BLOOM_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.compositePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.compositeLayout],
      }),
      vertex,
      fragment: {
        module: device.createShaderModule({
          label: "Bloom Composite Shader",
          code: bloomCompositeShader,
        }),
        entryPoint: "main",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
    const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.paramsX = device.createBuffer({
      label: "Bloom parameters (x)",
      size: 32,
      usage,
    });
    this.paramsY = device.createBuffer({
      label: "Bloom parameters (y)",
      size: 32,
      usage,
    });
  }

  private ensureTargets() {
    const source = this.input.getColorTexture();
    const { width, height } = source;
    if (
      this.targets &&
      this.targets.width === width &&
      this.targets.height === height
    ) {
      return this.targets;
    }
    this.targets?.a.destroy();
    this.targets?.b.destroy();
    const create = (label: string) =>
      this.device.createTexture({
        label,
        format: BLOOM_FORMAT,
        size: { width, height },
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.targets = {
      a: create("Bloom blur x"),
      b: create("Bloom blur y"),
      width,
      height,
    };
    return this.targets;
  }

  /** Runs the two blur passes. */
  prepare(encoder: GPUCommandEncoder) {
    const targets = this.ensureTargets();
    const amount =
      this.settings.radius * Math.max(targets.width, targets.height);
    const { threshold, strength } = this.settings;
    // the bright pass is applied while reading the source, i.e. in the x pass only
    this.device.queue.writeBuffer(
      this.paramsX,
      0,
      new Float32Array([1, 0, amount, threshold, strength, 0, 0, 0])
    );
    this.device.queue.writeBuffer(
      this.paramsY,
      0,
      new Float32Array([0, 1, amount, -1, strength, 0, 0, 0])
    );
    const blur = (
      source: GPUTextureView,
      target: GPUTexture,
      params: GPUBuffer
    ) => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target.createView(),
            clearValue: [0, 0, 0, 0],
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.blurPipeline);
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: this.blurLayout,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: source },
            { binding: 2, resource: { buffer: params } },
          ],
        })
      );
      pass.draw(3);
      pass.end();
    };
    blur(this.input.getColorView(), targets.a, this.paramsX);
    blur(targets.a.createView(), targets.b, this.paramsY);
  }

  /** Draws image + bloom into the current render pass. */
  render(pass: GPURenderPassEncoder) {
    const targets = this.ensureTargets();
    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.compositeLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.input.getColorView() },
          { binding: 2, resource: { buffer: this.paramsY } },
          { binding: 3, resource: targets.b.createView() },
        ],
      })
    );
    pass.draw(3);
  }

  destroy() {
    this.targets?.a.destroy();
    this.targets?.b.destroy();
    this.paramsX.destroy();
    this.paramsY.destroy();
  }
}
