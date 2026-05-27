import { Volume } from "./volume";
import { ChannelData } from "./channelData";
import type {
  VolumeDescriptor,
  VolumeDescriptorSettings,
} from "@/utils/volumeDescriptor";
import { pickDefaultTF } from "@/utils/helpers";
import { CONFIG } from "@/constants";
import { VolumeParameterBuffer } from "./volumeParameterBuffer";
import { mat4 } from "gl-matrix";
import { Observable } from "../utilities/observable";
import { TransferFunctionLut } from "./transferFunctionLut";

export interface VisualizationDescriptor {
  descriptors: VolumeDescriptor[];
  rawVolumeChannel?: number;
}

export class VolumeManager {
  private device: GPUDevice;
  volume: Volume;
  channelData: ChannelData;
  transferFunctionLut: TransferFunctionLut;
  volumeParameterBuffer: VolumeParameterBuffer;
  private modelMatrix: mat4 = mat4.create();

  private _settings: VolumeDescriptor["settings"] | undefined;

  observableSettings = new Observable(() => this._settings);

  constructor(device: GPUDevice) {
    this.device = device;
    this.channelData = new ChannelData(device);
    this.transferFunctionLut = new TransferFunctionLut(device);
    const volumeSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
    });
    this.volume = new Volume(device, volumeSampler);
    this.volumeParameterBuffer = new VolumeParameterBuffer(device);
  }

  get settings(): Readonly<VolumeDescriptor["settings"]> | undefined {
    return this._settings;
  }

  getUnits() {
    if (!this._settings) {
      return undefined;
    }
    switch (this._settings.physicalUnit) {
      case "PIXEL":
        return "px";
      case "UNIT":
        return "units";
      case "MICROMETER":
        return "µm";
      case "NANOMETER":
        return "nm";
      case "ANGSTROM":
        return "Å";
      default:
        return undefined;
    }
  }

  getPhysicalSize() {
    if (!this._settings) {
      return undefined;
    }

    const physicalSize = this._settings.physicalSize;

    if (this._settings.physicalUnit === "PIXEL") {
      const size = this._settings.size;
      return {
        x: size.x,
        y: size.y,
        z: size.z,
      };
    }

    return {
      x: physicalSize.x,
      y: physicalSize.y,
      z: physicalSize.z,
    };
  }

  getScaledPhysicalSize() {
    const physicalSize = this.getPhysicalSize();
    if (!physicalSize) return undefined;
    const ratio = this.getRatio();
    if (!ratio) return undefined;

    return {
      x: physicalSize.x * (1 / ratio.x),
      y: physicalSize.y * (1 / ratio.y),
      z: physicalSize.z * (1 / ratio.z),
    };
  }

  getRatio() {
    if (!this._settings) {
      return undefined;
    }

    const physicalSize = this.getPhysicalSize();
    if (!physicalSize) return undefined;

    const maxSize = Math.max(physicalSize.x, physicalSize.y, physicalSize.z);
    return {
      x: physicalSize.x / maxSize,
      y: physicalSize.y / maxSize,
      z: physicalSize.z / maxSize,
    };
  }

  getVoxelToWorld() {
    if (!this._settings) {
      return undefined;
    }

    const size = this._settings.size;
    const ratio = this.getRatio();
    if (!ratio) return undefined;

    const t = size.x / ratio.x;
    return 2 / t;
  }

  setSettings(settings: VolumeDescriptor["settings"] | undefined) {
    this._settings = settings;
    if (settings) {
      this.updateRatio();
    }
    this.observableSettings.notify();
  }

  setSettingParameters(parameters: Partial<VolumeDescriptorSettings>) {
    if (!this._settings) {
      throw new Error("Cannot set setting parameters before settings are set");
    }
    this._settings = { ...this._settings, ...parameters };
    if (parameters.physicalSize || parameters.physicalUnit) {
      this.updateRatio();
    }
    this.observableSettings.notify();
  }

  private updateRatio() {
    if (!this._settings) return;
    if (this._settings.physicalUnit === "PIXEL") {
      const size = this._settings.size;
      const maxSize = Math.max(size.x, size.y, size.z);
      this.volumeParameterBuffer.set({
        ratio: [size.x / maxSize, size.y / maxSize, size.z / maxSize, 1],
      });
    } else {
      const maxPhysicalSize = Math.max(
        this._settings.physicalSize.x,
        this._settings.physicalSize.y,
        this._settings.physicalSize.z
      );
      this.volumeParameterBuffer.set({
        ratio: [
          this._settings.physicalSize.x / maxPhysicalSize,
          this._settings.physicalSize.y / maxPhysicalSize,
          this._settings.physicalSize.z / maxPhysicalSize,
          1,
        ],
      });
    }
  }

  async loadVolumes(
    visualizationDescriptor: VisualizationDescriptor
  ): Promise<VisualizationDescriptor> {
    const descriptors = visualizationDescriptor.descriptors.splice(
      0,
      CONFIG.maxRenderedVolumes
    );

    await this.volume.loadData(descriptors);

    let rawVolumeChannel = visualizationDescriptor.rawVolumeChannel ?? -1;
    if (rawVolumeChannel >= descriptors.length) {
      rawVolumeChannel = -1;
    }

    // this.channelData.clearChannelData();
    let newSettings: VolumeDescriptor["settings"] | undefined;

    let tfIndex = 0;
    for (const descriptor of descriptors) {
      let transferFunction = descriptor.transferFunction;
      if (!transferFunction) {
        transferFunction = pickDefaultTF(
          tfIndex,
          descriptors.length === 1
        ).tfDefinition;
      }

      const settings = await descriptor.getSettings();
      if (newSettings === undefined) {
        newSettings = settings;
      }

      this.channelData.set(tfIndex, {
        visible: true,
        clipVisible: true,
      });

      this.transferFunctionLut.setBreakpoints(
        tfIndex,
        transferFunction.breakpoints
      );

      tfIndex++;
    }

    if (!newSettings) {
      throw new Error("Missing volume settings");
    }
    this.setSettings(newSettings);

    this.volumeParameterBuffer.set({
      numChannels: descriptors.length,
      rawVolumeChannel: rawVolumeChannel,
      rawClippingPlane: false,
    });

    return {
      rawVolumeChannel: rawVolumeChannel !== -1 ? rawVolumeChannel : undefined,
      descriptors: descriptors,
    };
  }

  getModelMatrix() {
    return this.modelMatrix;
  }

  destroy() {
    this.volume.destroy();
    this.channelData.destroy();
    this.transferFunctionLut.destroy();
  }
}
