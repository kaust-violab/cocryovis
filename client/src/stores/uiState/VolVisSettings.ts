import {
  getParentOfType,
  type Instance,
  type SnapshotIn,
} from "mobx-state-tree";
import { types } from "mobx-state-tree";
import { RootStore } from "../RootStore";
import type { VolumeRenderer } from "@/renderer/renderer";
import { v4 as uuid } from "uuid";
import { TransferFunction } from "./TransferFunction";

export const VolVisSettings = types
  .model({
    id: types.optional(types.identifier, () => uuid()),
    index: types.number,
    name: types.string,
    transferFunction: TransferFunction,
    visible: types.optional(types.boolean, true),
    clipVisible: types.optional(types.boolean, true),
    // clipping: types.optional(types.boolean, true),
    type: types.enumeration("VolumeType", ["volume", "raw"]),
  })
  .views((self) => ({
    get renderer(): VolumeRenderer | null {
      const rootStore = getParentOfType(self, RootStore);
      return rootStore.renderer;
    },
  }))
  .actions((self) => ({
    setVisibility(visible: boolean) {
      self.visible = visible;
      self.renderer?.volumeManager.channelData.set(self.index, {
        visible: visible,
      });
    },
    setClipVisibility(clipVisible: boolean) {
      self.clipVisible = clipVisible;
      self.renderer?.volumeManager.channelData.set(self.index, {
        clipVisible: clipVisible,
      });
    },
    // setClipping(clipping: boolean) {
    //   self.clipping = clipping;
    //   window.WasmModule?.clip_volume(clipping, self.index);
    // },
  }));

export interface VolVisSettingsInstance extends Instance<
  typeof VolVisSettings
> {}
export interface VolVisSettingsSnapshotIn extends SnapshotIn<
  typeof VolVisSettings
> {}
