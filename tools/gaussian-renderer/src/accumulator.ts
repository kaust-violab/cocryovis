// running average of the frames of a pass while nothing changes (progressive refinement, guide tasks a1 and q1)
// the pass draws each frame as always; this class adds that frame to an rgba16float image with weight 1/n
// through the blend constant, so the image holds the mean of the n frames without storing them

import fullscreenVertexShader from "@/assets/shaders/fullscreen.vs.wgsl?raw";
import fullscreenFragmentShader from "@/assets/shaders/fullscreen.fs.wgsl?raw";
import { BindGroup } from "@/renderer/core/bindGroup";
import { Framebuffer } from "@/renderer/core/framebuffer";

export class Accumulator {
  // the averaged image (16-bit float per channel), what the canvas shows
  readonly target: Framebuffer;
  private readonly bindGroup: BindGroup;
  private readonly pipeline: GPURenderPipeline;
  private n = 0; // frames in the average

  constructor(device: GPUDevice, input: Framebuffer, width: number, height: number) {
    this.target = new Framebuffer({ device, width, height, colorFormat: "rgba16float" });

    // same bindings as FullscreenComposite: sampler (0) and texture (1) of the input frame
    this.bindGroup = new BindGroup(device, {
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } },
      ],
    });
    this.bindGroup.setResource(0, input);
    this.bindGroup.setResource(1, input);

    // the fullscreen shaders of cocryovis (one triangle that covers the image, reads the input pixel)
    // plus a blend: new = frame * w + old * (1 - w), with w = 1/n set every frame as the blend constant
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroup.getBindGroupLayout()] }),
      vertex: {
        module: device.createShaderModule({ label: "Accumulate Vertex Shader", code: fullscreenVertexShader }),
        entryPoint: "main",
      },
      fragment: {
        module: device.createShaderModule({ label: "Accumulate Fragment Shader", code: fullscreenFragmentShader }),
        entryPoint: "main",
        targets: [
          {
            format: "rgba16float",
            blend: {
              color: { srcFactor: "constant", dstFactor: "one-minus-constant", operation: "add" },
              alpha: { srcFactor: "constant", dstFactor: "one-minus-constant", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  // how many frames are in the average now
  get count() {
    return this.n;
  }

  // start a new average (the next add() replaces the image instead of mixing)
  reset() {
    this.n = 0;
  }

  // records one pass that mixes the input frame into the average, call after the pass has drawn it
  add(encoder: GPUCommandEncoder) {
    const gpuBindGroup = this.bindGroup.getGPUBindGroup();
    if (!gpuBindGroup) return;
    this.n++;
    const w = 1 / this.n; // 1, 1/2, 1/3 … : the weight that keeps an exact mean
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.target.getColorView(),
          clearValue: [0, 0, 0, 0],
          loadOp: this.n === 1 ? "clear" : "load", // first frame: start from empty, then keep the old mean
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, gpuBindGroup);
    pass.setBlendConstant([w, w, w, w]);
    pass.draw(3);
    pass.end();
  }
}