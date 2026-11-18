import gvCommon from "@/assets/shaders/gaussian/gv_common.wgsl?raw";
import gvFieldGauss from "@/assets/shaders/gaussian/gv_field_gauss.wgsl?raw";
import gvLighting from "@/assets/shaders/gaussian/gv_lighting.wgsl?raw";
import gvLightCache from "@/assets/shaders/gaussian/gv_lightcache.comp.wgsl?raw";

import { BindGroup } from "../core/bindGroup";
import type { Camera } from "../core/camera";
import type { RenderingParametersBuffer } from "../renderingParametersBuffer";
import type { ClippingPlaneManager } from "../volume/clippingPlaneManager";
import type { VolumeManager } from "../volume/volumeManager";
import type { ExtParametersBuffer } from "./extParametersBuffer";
import type { GaussianScene } from "./gaussianScene";

export interface GaussianSharedInputs {
  device: GPUDevice;
  camera: Camera;
  volumeManager: VolumeManager;
  renderingParameters: RenderingParametersBuffer;
  clippingPlaneManager: ClippingPlaneManager;
  extParameters: ExtParametersBuffer;
}

/** Bindings of group 0 that the compute passes of the Gaussian renderer share. */
export function computeGroup0Layout(): GPUBindGroupLayoutDescriptor {
  const c = GPUShaderStage.COMPUTE;
  return {
    entries: [
      { binding: 0, visibility: c, buffer: { type: "uniform" } },
      { binding: 2, visibility: c, sampler: { type: "filtering" } },
      {
        binding: 5,
        visibility: c,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      { binding: 7, visibility: c, buffer: { type: "uniform" } },
      { binding: 8, visibility: c, buffer: { type: "uniform" } },
      { binding: 9, visibility: c, buffer: { type: "read-only-storage" } },
      { binding: 10, visibility: c, buffer: { type: "uniform" } },
      { binding: 11, visibility: c, buffer: { type: "uniform" } },
    ],
  };
}

export function setSharedResources(
  group: BindGroup,
  inputs: GaussianSharedInputs
) {
  group.setResource(0, inputs.camera);
  group.setResource(2, inputs.volumeManager.volume);
  group.setResource(5, inputs.volumeManager.transferFunctionLut);
  group.setResource(7, inputs.volumeManager.volumeParameterBuffer);
  group.setResource(8, inputs.renderingParameters);
  group.setResource(9, inputs.volumeManager.channelData);
  group.setResource(10, inputs.clippingPlaneManager.clippingParametersBuffer);
  group.setResource(11, inputs.extParameters);
}

/**
 * Computes ambient occlusion and shadow at the centre of every Gaussian and
 * stores them in the scene's light cache. The shadow depends on the light,
 * which follows the camera, so call update() after the camera, a transfer
 * function or a lighting parameter changed.
 */
export class GaussianLightCache {
  private readonly scene: GaussianScene;
  private readonly bindGroup: BindGroup;
  private readonly sceneBindGroup: GPUBindGroup;
  private readonly pipeline: GPUComputePipeline;

  constructor(inputs: GaussianSharedInputs & { scene: GaussianScene }) {
    const device = inputs.device;
    this.scene = inputs.scene;

    this.bindGroup = new BindGroup(device, computeGroup0Layout());
    setSharedResources(this.bindGroup, inputs);

    const c = GPUShaderStage.COMPUTE;
    const sceneLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: c, buffer: { type: "uniform" } },
        { binding: 1, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: c, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: c, buffer: { type: "storage" } },
      ],
    });
    const scene = inputs.scene;
    this.sceneBindGroup = device.createBindGroup({
      layout: sceneLayout,
      entries: [
        { binding: 0, resource: { buffer: scene.gridUniform } },
        { binding: 1, resource: { buffer: scene.gaussianBuffer } },
        { binding: 2, resource: { buffer: scene.cellBuffer } },
        { binding: 3, resource: { buffer: scene.indexBuffer } },
        { binding: 4, resource: { buffer: scene.lightCacheBuffer } },
      ],
    });
    this.pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroup.getBindGroupLayout(), sceneLayout],
      }),
      compute: {
        module: device.createShaderModule({
          label: "Gaussian Light Cache Compute Shader",
          code: [gvCommon, gvFieldGauss, gvLighting, gvLightCache].join("\n"),
        }),
        entryPoint: "main",
      },
    });
  }

  update(encoder: GPUCommandEncoder) {
    const group = this.bindGroup.getGPUBindGroup();
    if (!group) return;
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, this.sceneBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.scene.count / 64));
    pass.end();
  }
}
