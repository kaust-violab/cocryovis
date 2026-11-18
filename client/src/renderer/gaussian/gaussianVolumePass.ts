import volumeVertexShader from "@/assets/shaders/volume.vs.wgsl?raw";
import gvCommon from "@/assets/shaders/gaussian/gv_common.wgsl?raw";
import gvFieldVoxel from "@/assets/shaders/gaussian/gv_field_voxel.wgsl?raw";
import gvFieldGauss from "@/assets/shaders/gaussian/gv_field_gauss.wgsl?raw";
import gvFieldGaussCache from "@/assets/shaders/gaussian/gv_field_gauss_cache.wgsl?raw";
import gvLighting from "@/assets/shaders/gaussian/gv_lighting.wgsl?raw";
import gvMarch from "@/assets/shaders/gaussian/gv_march.fs.wgsl?raw";

import type { AnnotationManager } from "../annotations/annotationManager";
import { BindGroup } from "../core/bindGroup";
import type { Camera } from "../core/camera";
import { Framebuffer } from "../core/framebuffer";
import { DEPTH_TEXTURE_FORMAT } from "../core/defines";
import type { RenderingParametersBuffer } from "../renderingParametersBuffer";
import type { ClippingPlaneManager } from "../volume/clippingPlaneManager";
import type { VolumeManager } from "../volume/volumeManager";
import type { ExtParametersBuffer } from "./extParametersBuffer";
import { GaussianLightCache } from "./gaussianLightCache";
import type { GaussianScene } from "./gaussianScene";

/**
 * Where the pass reads its four channels from: the packed voxel texture of the
 * VolumeManager (then the pass is VolumePass plus the reference look), or a
 * Gaussian scene.
 */
export type FieldSource =
  { kind: "voxel" } | { kind: "gaussian"; scene: GaussianScene };

function group0Layout(
  field: FieldSource["kind"]
): GPUBindGroupLayoutDescriptor {
  const frag = GPUShaderStage.FRAGMENT;
  const both = GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX;
  const entries: GPUBindGroupLayoutEntry[] = [
    { binding: 0, visibility: both, buffer: { type: "uniform" } },
    { binding: 2, visibility: frag, sampler: { type: "filtering" } },
    {
      binding: 4,
      visibility: frag,
      texture: { sampleType: "float", viewDimension: "3d" },
    },
    {
      binding: 5,
      visibility: frag,
      texture: { sampleType: "float", viewDimension: "2d" },
    },
    { binding: 6, visibility: frag, buffer: { type: "read-only-storage" } },
    { binding: 7, visibility: frag, buffer: { type: "uniform" } },
    { binding: 8, visibility: frag, buffer: { type: "uniform" } },
    { binding: 9, visibility: frag, buffer: { type: "read-only-storage" } },
    { binding: 10, visibility: both, buffer: { type: "uniform" } },
    { binding: 11, visibility: frag, buffer: { type: "uniform" } },
  ];
  if (field === "voxel") {
    entries.push({
      binding: 3,
      visibility: frag,
      texture: { sampleType: "float", viewDimension: "3d" },
    });
  }
  entries.sort((a, b) => a.binding - b.binding);
  return { entries };
}

function group1Layout(): GPUBindGroupLayoutDescriptor {
  const visibility = GPUShaderStage.FRAGMENT;
  return {
    entries: [
      { binding: 0, visibility, buffer: { type: "uniform" } },
      { binding: 1, visibility, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility, buffer: { type: "read-only-storage" } },
    ],
  };
}

/**
 * Ray-marching volume pass with a pluggable field. It consumes the same camera,
 * transfer-function, rendering-parameter and clipping buffers as VolumePass,
 * plus ExtParametersBuffer for the look and lighting mode.
 */
export class GaussianVolumePass {
  private readonly device: GPUDevice;
  private readonly bindGroup: BindGroup;
  private readonly pipeline: GPURenderPipeline;
  readonly framebuffer: Framebuffer;
  readonly field: FieldSource;

  private readonly sceneBindGroup: GPUBindGroup | undefined;

  private readonly lightCache: GaussianLightCache | undefined;

  constructor({
    device,
    width,
    height,
    format,
    camera,
    volumeManager,
    annotationManager,
    renderingParameters,
    clippingPlaneManager,
    extParameters,
    field,
  }: {
    device: GPUDevice;
    width: number;
    height: number;
    format: GPUTextureFormat;
    camera: Camera;
    volumeManager: VolumeManager;
    annotationManager: AnnotationManager;
    renderingParameters: RenderingParametersBuffer;
    clippingPlaneManager: ClippingPlaneManager;
    extParameters: ExtParametersBuffer;
    field: FieldSource;
  }) {
    this.device = device;
    this.field = field;
    this.framebuffer = new Framebuffer({
      device,
      width,
      height,
      colorFormat: format,
      depthFormat: DEPTH_TEXTURE_FORMAT,
    });

    const setShared = (group: BindGroup) => {
      group.setResource(0, camera);
      group.setResource(2, volumeManager.volume);
      group.setResource(5, volumeManager.transferFunctionLut);
      group.setResource(7, volumeManager.volumeParameterBuffer);
      group.setResource(8, renderingParameters);
      group.setResource(9, volumeManager.channelData);
      group.setResource(10, clippingPlaneManager.clippingParametersBuffer);
      group.setResource(11, extParameters);
    };

    this.bindGroup = new BindGroup(device, group0Layout(field.kind));
    setShared(this.bindGroup);
    this.bindGroup.setResource(4, annotationManager.getAnnotationVolume());
    this.bindGroup.setResource(6, annotationManager.annotationsDataBuffer);
    if (field.kind === "voxel") {
      this.bindGroup.setResource(3, volumeManager.volume);
    }

    const layouts = [this.bindGroup.getBindGroupLayout()];
    let fieldCode = gvFieldVoxel;
    if (field.kind === "gaussian") {
      const sceneLayout = device.createBindGroupLayout(group1Layout());
      layouts.push(sceneLayout);
      this.sceneBindGroup = this.createSceneBindGroup(sceneLayout, field.scene);
      fieldCode = gvFieldGauss + "\n" + gvFieldGaussCache;
    }

    const fragmentCode = [gvCommon, fieldCode, gvLighting, gvMarch].join("\n");
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
      vertex: {
        module: device.createShaderModule({
          label: "Volume Vertex Shader",
          code: volumeVertexShader,
        }),
        entryPoint: "main",
      },
      fragment: {
        module: device.createShaderModule({
          label: `Gaussian Volume Fragment Shader (${field.kind})`,
          code: fragmentCode,
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

    if (field.kind === "gaussian") {
      this.lightCache = new GaussianLightCache({
        device,
        camera,
        volumeManager,
        renderingParameters,
        clippingPlaneManager,
        extParameters,
        scene: field.scene,
      });
    }
  }

  private createSceneBindGroup(
    layout: GPUBindGroupLayout,
    scene: GaussianScene
  ) {
    return this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: scene.gridUniform } },
        { binding: 1, resource: { buffer: scene.gaussianBuffer } },
        { binding: 2, resource: { buffer: scene.cellBuffer } },
        { binding: 3, resource: { buffer: scene.indexBuffer } },
        { binding: 4, resource: { buffer: scene.lightCacheBuffer } },
      ],
    });
  }

  resize(width: number, height: number) {
    this.framebuffer.resize(width, height);
  }

  /**
   * Recomputes ambient occlusion and shadow per Gaussian. Needed for
   * LightingMode.Cached, after the camera, the transfer functions or the
   * lighting parameters changed.
   */
  updateLightCache(encoder: GPUCommandEncoder) {
    this.lightCache?.update(encoder);
  }

  render(encoder: GPUCommandEncoder, clearColor: GPUColor) {
    const gpuBindGroup = this.bindGroup.getGPUBindGroup();
    const pass = encoder.beginRenderPass(
      this.framebuffer.getRenderPassDescriptor(clearColor)
    );
    if (gpuBindGroup) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, gpuBindGroup);
      if (this.sceneBindGroup) {
        pass.setBindGroup(1, this.sceneBindGroup);
      }
      pass.draw(6);
    }
    pass.end();
  }

  destroy() {
    this.framebuffer.destroy();
  }
}
