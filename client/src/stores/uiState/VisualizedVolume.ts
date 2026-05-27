import {
  getParentOfType,
  getType,
  type Instance,
  type SnapshotIn,
  castToReferenceSnapshot,
} from "mobx-state-tree";
import { types } from "mobx-state-tree";
import { VolVisSettings } from "./VolVisSettings";
import type { VolumeInstance } from "../userState/VolumeModel";
import { Volume } from "../userState/VolumeModel";
import type { ResultInstance } from "../userState/ResultModel";
import { Result } from "../userState/ResultModel";
import { flow, isAlive } from "mobx-state-tree";
import * as Utils from "../../utils/helpers";
import type { SparseVolumeInstance } from "../userState/SparseVolumeModel";
import { SparseLabelVolume } from "../userState/SparseVolumeModel";
import type { PseudoVolumeInstance } from "../userState/PseudoVolumeModel";
import { PseudoLabelVolume } from "../userState/PseudoVolumeModel";
import type z from "zod";
import type { getVolumeSchema } from "@cocryovis/schemas/volume-path-schema";
import { downloadFullVolumeData } from "@/api/volumeData";
import { getVolumeWithSparseVolumes } from "@/api/volume";
import ToastContainer from "../../utils/toastContainer";
import type { VolumeRenderer } from "@/renderer/renderer";
import { RootStore } from "../RootStore";
import { clamp } from "@/utils/helpers";
import type { ClippingPlaneType } from "@/renderer/volume/clippingPlaneManager";
import type { VolumeDescriptor } from "@/utils/volumeDescriptor";
import { fileMapToVisualizationConfig } from "@/utils/volumeVisualization";
import type { CameraController } from "@/renderer/cameraControllers/cameraController";

export type visualizedObjectInstances =
  | VolumeInstance
  | SparseVolumeInstance
  | PseudoVolumeInstance
  | SparseVolumeInstance[]
  | PseudoVolumeInstance[]
  | ResultInstance
  | undefined;

export interface VisualizedVolumeInput extends Omit<
  SnapshotIn<typeof VisualizedVolume>,
  | "volume"
  | "sparseLabelVolume"
  | "pseudoLabelVolume"
  | "result"
  | "sparseLabelVolumes"
  | "pseudoLabelVolumes"
> {
  visualizedObject?: visualizedObjectInstances;
}

async function loadSparseLabelVolumesIntoAnnotations(
  renderer: VolumeRenderer,
  volume: VolumeInstance,
  toastContainer: ToastContainer
) {
  const sparseVolumeArray = volume.sparseVolumeArray;
  const volumeDescriptors: VolumeDescriptor[] = [];
  for (let i = 0; i < sparseVolumeArray.length; i++) {
    const sparseVolume = sparseVolumeArray[i];
    toastContainer.loading(
      `Fetching manual label volume ${i + 1}/${sparseVolumeArray.length}`
    );

    await Utils.waitForNextFrame();

    const contents = await downloadFullVolumeData(
      "SparseLabeledVolumeData",
      sparseVolume.id
    );
    const fileMap = await Utils.zipToFileMap(contents);
    const visualizationConfig = await fileMapToVisualizationConfig(fileMap);
    if (visualizationConfig.descriptors.length < 1) {
      throw new Error("No volume data found in the sparse label volume.");
    }
    volumeDescriptors.push(visualizationConfig.descriptors[0]);
  }
  if (sparseVolumeArray.length > 0) {
    await renderer.annotationManager.pingVolume.loadData(volumeDescriptors);
  }
  for (let i = sparseVolumeArray.length; i < 4; i++) {
    const color = Utils.fromHexColor(volume.sparseLabelColors[i]);
    renderer.annotationManager.annotationsDataBuffer.set(i, {
      color: [color.r / 255, color.g / 255, color.b / 255, 1],
      enabled: false,
    });
  }
  for (let i = 0; i < sparseVolumeArray.length; i++) {
    const sparseVolume = sparseVolumeArray[i];
    let r = 1;
    let g = 1;
    let b = 1;

    if (sparseVolume.color !== null) {
      const color = Utils.fromHexColor(sparseVolume.color);
      r = color.r / 255;
      g = color.g / 255;
      b = color.b / 255;
    }
    renderer.annotationManager.annotationsDataBuffer.set(i, {
      color: [r, g, b, 1],
      enabled: true,
    });
  }
}

export const clippingPlaneOptions = [
  { value: "view-aligned", label: "View Aligned" },
  { value: "x", label: "X-Axis" },
  { value: "y", label: "Y-Axis" },
  { value: "z", label: "Z-Axis" },
  { value: "none", label: "None" },
] as const;

export const VisualizedVolume = types
  .model("VisualizedVolume", {
    volume: types.safeReference(Volume),
    sparseLabelVolume: types.safeReference(SparseLabelVolume),
    sparseLabelVolumes: types.maybe(
      types.array(types.safeReference(SparseLabelVolume))
    ),
    pseudoLabelVolume: types.safeReference(PseudoLabelVolume),
    pseudoLabelVolumes: types.maybe(
      types.array(types.safeReference(PseudoLabelVolume))
    ),
    result: types.maybe(types.safeReference(Result)),
    volVisSettings: types.array(VolVisSettings),
    clippingPlane: types.optional(
      types.enumeration(
        "ClippingPlane",
        clippingPlaneOptions.map((option) => option.value)
      ),
      "none"
    ),
    clippingPlaneOffset: types.optional(types.number, 0),
    clippingPlaneOffsetX: types.optional(types.integer, 0),
    clippingPlaneOffsetY: types.optional(types.integer, 0),
    clippingPlaneOffsetZ: types.optional(types.integer, 0),
    labelEditingMode: types.optional(types.boolean, false),
    manualLabelIndex: types.optional(types.integer, 0),
    fullscreen: types.optional(types.boolean, false),
    showRawClippingPlane: types.optional(types.boolean, false),
    eraseMode: types.optional(types.boolean, false),
    saveAsNew: types.optional(types.array(types.boolean), Array(4).fill(false)),
  })
  .views((self) => ({
    get rawSettings() {
      return self.volVisSettings.find(
        (volVisSettings) => volVisSettings.type === "raw"
      );
    },
    get volumeSettings() {
      return self.volVisSettings.filter(
        (volVisSettings) => volVisSettings.type === "volume"
      );
    },
    get canEditLabels() {
      return self.volume !== undefined;
    },
    get renderer(): VolumeRenderer | null {
      const rootStore = getParentOfType(self, RootStore);
      return rootStore.renderer;
    },
    get orbitCameraController(): CameraController | null {
      const rootStore = getParentOfType(self, RootStore);
      return rootStore.orbitCameraController;
    },
  }))
  .actions((self) => ({
    resetSaveAsNew() {
      for (let i = 0; i < self.saveAsNew.length; i++) {
        self.saveAsNew[i] = false;
      }
    },
    setVisualizedObject(visualizedObject: visualizedObjectInstances) {
      if (visualizedObject === undefined) {
        return;
      }
      // This only exist since for whatever reason safeReference fails if object are passed on creation time, so we have to assign them later...
      if (Array.isArray(visualizedObject)) {
        if (visualizedObject.length > 0) {
          if (PseudoLabelVolume.is(visualizedObject[0])) {
            // @ts-expect-error - MST types are weird, but this works
            self.pseudoLabelVolumes = (
              visualizedObject as PseudoVolumeInstance[]
            ).map((pseudoVolume) => castToReferenceSnapshot(pseudoVolume));
          } else if (SparseLabelVolume.is(visualizedObject[0])) {
            // @ts-expect-error - MST types are weird, but this works
            self.sparseLabelVolumes =
              visualizedObject as SparseVolumeInstance[];
          }
        }
      } else if (Volume.is(visualizedObject)) {
        self.volume = visualizedObject;
      } else if (getType(visualizedObject) === Result) {
        self.result = visualizedObject as ResultInstance;
      } else if (getType(visualizedObject) === PseudoLabelVolume) {
        self.pseudoLabelVolume = visualizedObject as PseudoVolumeInstance;
      } else if (getType(visualizedObject) === SparseLabelVolume) {
        self.sparseLabelVolume = visualizedObject as SparseVolumeInstance;
      }
    },
    setFullscreen(enable: boolean) {
      if (!self.renderer) {
        return;
      }
      if (enable === self.fullscreen) {
        return;
      }
      if (enable && self.clippingPlane === "none") {
        return;
      }
      self.fullscreen = enable;
      self.orbitCameraController?.setActive(!enable);
      self.renderer.clippingPlaneManager.setFullscreen(enable);
    },
    setShowRawClippingPlane(enable: boolean) {
      if (!self.renderer) {
        return;
      }
      if (enable && self.rawSettings === undefined) {
        return;
      }
      self.showRawClippingPlane = enable;
      self.renderer.volumeManager.volumeParameterBuffer.set({
        rawClippingPlane: enable,
      });
    },
    setEraseMode(enable: boolean) {
      if (!self.canEditLabels || !self.labelEditingMode) {
        return;
      }

      self.eraseMode = enable;
    },
    setClippingOffset(offset: number) {
      if (!self.renderer) {
        return;
      }
      if (self.clippingPlane === "none") {
        return;
      }
      self.clippingPlaneOffset = clamp(offset, -1, 1);
      self.renderer.clippingPlaneManager.setClippingPlaneOffset(offset);
    },
    setClippingOffsetX(offset: number) {
      if (!self.renderer) {
        return;
      }
      const sizeX = self.renderer.volumeManager.settings?.size.x;
      if (sizeX === undefined) {
        return;
      }
      offset = clamp(offset, 0, sizeX - 1);
      self.clippingPlaneOffsetX = offset;
      self.renderer.clippingPlaneManager.setClippingPlaneOffsetVoxel(offset);
    },
    setClippingOffsetY(offset: number) {
      if (!self.renderer) {
        return;
      }
      const sizeY = self.renderer.volumeManager.settings?.size.x;
      if (sizeY === undefined) {
        return;
      }
      offset = clamp(offset, 0, sizeY - 1);
      self.clippingPlaneOffsetY = offset;
      self.renderer.clippingPlaneManager.setClippingPlaneOffsetVoxel(offset);
    },
    setClippingOffsetZ(offset: number) {
      if (!self.renderer) {
        return;
      }
      const sizeZ = self.renderer.volumeManager.settings?.size.z;
      if (sizeZ === undefined) {
        return;
      }
      offset = clamp(offset, 0, sizeZ - 1);
      self.clippingPlaneOffsetZ = offset;
      self.renderer.clippingPlaneManager.setClippingPlaneOffsetVoxel(offset);
    },
  }))
  .actions((self) => ({
    setManualLabelIndex(index: number) {
      self.manualLabelIndex = index;
      self.volume?.setShownAnnotation(index, true);
      if (self.renderer) {
        self.renderer.annotationManager.activeLabelIndex = index;
      }
    },
    setClippingPlane(clippingPlane: ClippingPlaneType) {
      if (!self.renderer) {
        return;
      }
      self.clippingPlane = clippingPlane;
      self.renderer.clippingPlaneManager.setClippingPlane(clippingPlane);
      if (clippingPlane === "x") {
        self.renderer.clippingPlaneManager.setClippingPlaneOffsetVoxel(
          self.clippingPlaneOffsetX
        );
      } else if (clippingPlane === "y") {
        self.renderer.clippingPlaneManager.setClippingPlaneOffsetVoxel(
          self.clippingPlaneOffsetY
        );
      } else if (clippingPlane === "z") {
        self.renderer.clippingPlaneManager.setClippingPlaneOffsetVoxel(
          self.clippingPlaneOffsetZ
        );
      } else {
        self.renderer.clippingPlaneManager.setClippingPlaneOffset(
          self.clippingPlaneOffset
        );
      }
      if (self.fullscreen && clippingPlane === "none") {
        self.setFullscreen(false);
      }
    },
    changeClippingPlaneOffset(offset: number) {
      if (self.clippingPlane === "x") {
        self.setClippingOffsetX(self.clippingPlaneOffsetX + Math.sign(offset));
      } else if (self.clippingPlane === "y") {
        self.setClippingOffsetY(self.clippingPlaneOffsetY + Math.sign(offset));
      } else if (self.clippingPlane === "z") {
        self.setClippingOffsetZ(self.clippingPlaneOffsetZ + Math.sign(offset));
      } else {
        self.setClippingOffset(self.clippingPlaneOffset + offset);
      }
    },
    clearActiveAnnotationChannel() {
      if (!self.renderer) {
        return;
      }
      if (self.manualLabelIndex > 4 || self.manualLabelIndex < 0) {
        return;
      }
      self.saveAsNew[self.manualLabelIndex] = true;
      self.renderer.annotationManager.clearAnnotations(self.manualLabelIndex);
    },
  }))
  .actions((self) => ({
    setLabelEditingMode: flow(function* setLabelEditingMode(enable: boolean) {
      self.resetSaveAsNew();
      if (!enable) {
        self.labelEditingMode = false;
        self.renderer?.renderingParameters.set({
          enableAnnotations: false,
        });
        self.renderer?.annotationManager.clearAnnotations(-1);
        return;
      }
      const toastContainer = new ToastContainer();
      try {
        toastContainer.loading("Fetching volume data...");
        if (!self.renderer) {
          throw new Error("Renderer is not initialized.");
        }
        if (self.volume === undefined) {
          throw new Error("Only raw volumes can be labeled.");
        }

        const volume = (yield getVolumeWithSparseVolumes(
          self.volume.id
        )) as z.infer<typeof getVolumeSchema>;
        if (!isAlive(self)) {
          return;
        }
        self.volume.setSparseVolumes(volume.sparseVolumes);
        yield loadSparseLabelVolumesIntoAnnotations(
          self.renderer,
          self.volume,
          toastContainer
        );
        if (!isAlive(self)) {
          return;
        }

        self.labelEditingMode = enable;
        self.renderer.renderingParameters.set({
          enableAnnotations: true,
        });
        self.setManualLabelIndex(0);

        if (self.clippingPlane === "none") {
          self.setClippingPlane("z");
        }
        toastContainer.success("Labeling mode enabled.");
      } catch (error) {
        toastContainer.error(Utils.getErrorMessage(error));
        throw error;
      }
    }),
  }));

export interface VisualizedVolumeInstance extends Instance<
  typeof VisualizedVolume
> {}
export interface VisualizedVolumeSnapshotIn extends SnapshotIn<
  typeof VisualizedVolume
> {}
