import path from "path";
import fsPromises from "node:fs/promises";
import fileSystem from "fs";
import DatabaseModel, { withTransaction } from "./database-model";
import appConfig from "../tools/config";
import Utils from "../tools/utils";
import type { PendingUpload } from "../tools/file-handler";
import { ApiError, MissingResourceError } from "../tools/error-handler";
import { ZipArchive } from "archiver";
import type { Prisma } from "@prisma/client";
import prismaManager from "../tools/prisma-manager";
import type z from "zod";
import type { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
import type {
  volumeDescriptorSettingsSchema,
  volumeSettings,
} from "@cocryovis/schemas/componentSchemas/volume-settings-schema";

export type VolumeDataDB =
  RawVolumeDataDB | SparseLabelVolumeDataDB | PseudoLabelVolumeDataDB;
export type DataFileDB =
  RawVolumeDataFileDB | SparseVolumeDataFileDB | PseudoVolumeDataFileDB;
export type VolumeDataWithFile =
  | RawVolumeDataWithFileDB
  | SparseVolumeDataWithFileDB
  | PseudoVolumeDataWithFileDB;
export type RawVolumeDataWithFileDB = RawVolumeDataDB & {
  dataFile: RawVolumeDataFileDB;
};
export type SparseVolumeDataWithFileDB = SparseLabelVolumeDataDB & {
  dataFile: SparseVolumeDataFileDB;
};
export type PseudoVolumeDataWithFileDB = PseudoLabelVolumeDataDB & {
  dataFile: PseudoVolumeDataFileDB;
};

export type VolumeDataModelName =
  "rawVolumeData" | "sparseLabelVolumeData" | "pseudoLabelVolumeData";
export type VolumeDataFileModelName =
  "rawVolumeDataFile" | "sparseVolumeDataFile" | "pseudoVolumeDataFile";

/**
 * The subset of the raw/sparse/pseudo volume data Prisma delegates that the
 * shared VolumeData methods call.
 */
interface VolumeDataDelegate {
  findUniqueOrThrow(args: {
    where: { id: number };
    include: { dataFile: true };
  }): Promise<VolumeDataWithFile>;
  findUnique(args: {
    where: { id: number };
    include: { volumes: true };
  }): Promise<{ volumes: VolumeDB[] } | null>;
  create(args: { data: object }): Promise<VolumeDataDB>;
}

interface VolumeDataFileDelegate {
  update(args: {
    where: { id: number };
    data: { path: string; rawFilePath: string };
  }): Promise<unknown>;
}

export interface CreateFromFilesOptions {
  skipLock?: boolean;
  client?: Prisma.TransactionClient;
  reconstructionParameters?: z.infer<typeof tiltSeriesOptions>;
}

export const volumeDataFolder = "volume-data";

export default class VolumeData extends DatabaseModel {
  static rawFileExtensions = [".raw"];
  static settingFileExtensions = [".json"];
  static acceptedFileExtensions = this.rawFileExtensions.concat(
    this.settingFileExtensions
  );
  static fileModelName = "";
  static fileClass: { createVolumeDataFolder(id: number): Promise<string> };

  static toSettingSchema(
    volumeData: VolumeDataDB & { dataFile: { rawFilePath: string | null } },
    physicalDimensions: PhysicalDimensions
  ): z.infer<typeof volumeSettings> {
    const rawFilePath = volumeData.dataFile.rawFilePath;
    if (!rawFilePath) {
      throw new ApiError(404, "Volume data is missing its raw file.");
    }
    return {
      file: path.basename(rawFilePath),
      size: {
        x: volumeData.sizeX,
        y: volumeData.sizeY,
        z: volumeData.sizeZ,
      },
      physicalUnit: physicalDimensions.physicalUnit,
      physicalSize: {
        x: physicalDimensions.physicalSizeX,
        y: physicalDimensions.physicalSizeY,
        z: physicalDimensions.physicalSizeZ,
      },
      bytesPerVoxel: volumeData.bytesPerVoxel,
      usedBits: volumeData.usedBits,
      skipBytes: volumeData.skipBytes,
      isLittleEndian: volumeData.isLittleEndian,
      isSigned: volumeData.isSigned,
      addValue: volumeData.addValue,
    };
  }

  static fromSettingSchema(
    settings: z.infer<typeof volumeDescriptorSettingsSchema>
  ) {
    return {
      sizeX: settings.size.x,
      sizeY: settings.size.y,
      sizeZ: settings.size.z,
      bytesPerVoxel: settings.bytesPerVoxel,
      usedBits: settings.usedBits,
      skipBytes: settings.skipBytes,
      isLittleEndian: settings.isLittleEndian,
      isSigned: settings.isSigned,
      addValue: settings.addValue,
    };
  }

  static get folderPath(): string {
    throw new Error("Method not implemented");
  }

  static override async getById(id: number): Promise<VolumeDataDB> {
    return (await super.getById(id)) as VolumeDataDB;
  }

  static async getWithData(id: number) {
    const volumeData = await (this.db as VolumeDataDelegate).findUniqueOrThrow({
      where: { id: id },
      include: {
        dataFile: true,
      },
    });
    return volumeData;
  }

  static async belongsToVolume(
    volumeDataId: number,
    volumeId: number
  ): Promise<boolean> {
    const volumeData = await (this.db as VolumeDataDelegate).findUnique({
      where: { id: volumeDataId },
      include: {
        volumes: true,
      },
    });
    if (!volumeData?.volumes.some((v) => v.id === volumeId)) {
      return false;
    }
    return true;
  }

  static async createFromFiles(
    creatorId: number,
    volumeId: number,
    files: PendingUpload[],
    settings: z.infer<typeof volumeDescriptorSettingsSchema>,
    {
      skipLock = false,
      client,
      reconstructionParameters,
    }: CreateFromFilesOptions = {}
  ): Promise<VolumeDataDB> {
    // Temporary fix to avoid circular dependency.
    const { default: Volume } = await import("./volume");

    return await Volume.withWriteLock(
      volumeId,
      [this.modelName],
      async () => {
        const rawFile = files.find((f) =>
          Utils.isFileExtensionAccepted(f.fileName, this.rawFileExtensions)
        );

        if (!rawFile) {
          throw new ApiError(400, "Volume data requires a .raw file create.");
        }

        return await withTransaction(client, async (tx) => {
          const volume = await tx.volume.findUnique({
            where: {
              id: volumeId,
            },
            include: {
              rawData: true,
            },
          });
          if (!volume) {
            throw MissingResourceError.fromId(volumeId, "volume");
          }

          if (volume.rawData === null) {
            await tx.volume.update({
              where: {
                id: volumeId,
              },
              data: {
                physicalUnit: settings.physicalUnit,
                physicalSizeX: settings.physicalSize.x,
                physicalSizeY: settings.physicalSize.y,
                physicalSizeZ: settings.physicalSize.z,
              },
            });
          }

          const volumeData = await (
            tx[
              this.modelName as VolumeDataModelName
            ] as unknown as VolumeDataDelegate
          ).create({
            data: {
              creator: { connect: { id: creatorId } },
              volume: { connect: { id: volumeId } },
              ...VolumeData.fromSettingSchema(settings),
              dataFile: {
                create: {},
              },
              name: Utils.stripExtension(rawFile.fileName),
              ...(reconstructionParameters && {
                reconstructionParameters: reconstructionParameters,
              }),
            },
          });
          let folderPath: string | null = null;
          try {
            folderPath = await this.fileClass.createVolumeDataFolder(
              volumeData.id
            );
            const rawFilePath = await rawFile.saveAs(folderPath);

            await (
              tx[
                this.fileModelName as VolumeDataFileModelName
              ] as unknown as VolumeDataFileDelegate
            ).update({
              where: { id: volumeData.dataFileId },
              data: {
                path: folderPath,
                rawFilePath: rawFilePath,
              },
            });
          } catch (error) {
            if (folderPath != null) {
              await fsPromises.rm(folderPath, {
                recursive: true,
                force: true,
              });
            }
            throw error;
          }
          return volumeData;
        });
      },
      skipLock
    );
  }

  static override async update(
    id: number,
    changes: object
  ): Promise<VolumeDataDB> {
    return (await super.update(id, changes)) as VolumeDataDB;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- keep thrown errors as promise rejections
  static async parseSettings(
    settingsString: string,
    rawFilePath: string | null = null
  ) {
    const settings = JSON.parse(settingsString) as Record<string, unknown>;
    if (rawFilePath) {
      settings.file = path.basename(rawFilePath);
    }
    if (!Object.hasOwn(settings, "transferFunction")) {
      settings.transferFunction = "tf-default.json";
    }
    return JSON.stringify(settings);
  }

  static checkFilePath(folderPath: string, fileName: string) {
    let fileNameOverride: string | null = null;
    const potentialSettingFilePath = path.join(folderPath, fileName);
    if (fileSystem.existsSync(potentialSettingFilePath)) {
      fileNameOverride = Utils.generateUniqueFileName(potentialSettingFilePath);
    }
    return fileNameOverride;
  }

  static async prepareDataForDownload(
    id: number,
    downloadRawFile = true,
    downloadSettingsFile = true
  ) {
    const volumeData = await this.getWithData(id);

    const volume = await prismaManager.db.volume.findUnique({
      where: { id: volumeData.volumeId },
    });
    if (!volume) {
      throw MissingResourceError.fromId(volumeData.volumeId, "volume");
    }

    let hasFiles = false;

    const archive = new ZipArchive({
      zlib: { level: appConfig.compressionLevel },
    });

    if (downloadRawFile && volumeData.dataFile.rawFilePath != null) {
      archive.file(volumeData.dataFile.rawFilePath, {
        name: path.basename(volumeData.dataFile.rawFilePath),
      });
      hasFiles = true;
    }
    if (downloadSettingsFile) {
      const settings = VolumeData.toSettingSchema(volumeData, volume);
      const settingsJSON = JSON.stringify(settings, null, 4);
      archive.append(settingsJSON, {
        name: `${Utils.stripExtension(settings.file)}.json`,
      });
      hasFiles = true;
    }

    if (!hasFiles) {
      throw new ApiError(404, "No files to download.");
    }

    if (!volumeData.dataFile.path) {
      throw new ApiError(404, "Volume data has no files on disk.");
    }
    const outputFileName = `${this.modelName}_${Utils.stripExtension(
      volumeData.dataFile.path
    )}`;
    return {
      name: `${outputFileName}.zip`,
      archive: archive,
    };
  }
}
