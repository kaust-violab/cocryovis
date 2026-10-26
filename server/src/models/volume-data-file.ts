import type { PseudoVolumeDataFile } from "@prisma/client";
import DatabaseModel from "./database-model";

export type PseudoVolumeDataFileDB = PseudoVolumeDataFile;

export default class VolumeDataFile extends DatabaseModel {
  static volumeDataFolder = "volume-data";
}
