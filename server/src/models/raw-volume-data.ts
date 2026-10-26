import path from "path";
import Utils from "../tools/utils";
import VolumeData, { type CreateFromFilesOptions } from "./volume-data";
import prismaManager from "../tools/prisma-manager";
import fsPromises from "node:fs/promises";
import type { PendingUpload } from "../tools/file-handler";
import WriteLockManager from "../tools/write-lock-manager";
import Volume from "./volume";
import { ApiError } from "../tools/error-handler";
import appConfig from "../tools/config";
import { ZipArchive } from "archiver";
import RawVolumeDataFile from "./raw-volume-data-file";
import { withTransaction } from "./database-model";
import type { Prisma } from "@prisma/client";
import type z from "zod";
import type { volumeDescriptorSettingsSchema } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";

export default class RawVolumeData extends VolumeData {
  static override modelName = "rawVolumeData";
  static override fileModelName = "rawVolumeDataFile";
  static override lockManager = new WriteLockManager(this.modelName);
  static mrcTempDirectory = path.join(appConfig.tempPath, "mrc");
  static override fileClass = RawVolumeDataFile;

  static override get db() {
    return prismaManager.db.rawVolumeData;
  }

  static override async getById(id: number): Promise<RawVolumeDataDB> {
    return (await super.getById(id)) as RawVolumeDataDB;
  }

  static override async getWithData(id: number) {
    const volumeData = await this.db.findUniqueOrThrow({
      where: { id: id },
      include: {
        dataFile: true,
      },
    });
    return volumeData;
  }

  static async getFromVolumeId(id: number): Promise<RawVolumeDataDB | null> {
    const volumeData = await this.db.findUnique({
      where: { volumeId: id },
    });
    return volumeData;
  }

  static async getFromVolumeIdWithData(id: number) {
    const volumeData = await this.db.findUnique({
      where: { volumeId: id },
      include: { dataFile: true },
    });
    return volumeData;
  }

  static override async create(
    creatorId: number,
    volumeId: number
  ): Promise<RawVolumeDataDB> {
    return (await super.create(creatorId, volumeId)) as RawVolumeDataDB;
  }

  static override async createFromFiles(
    creatorId: number,
    volumeId: number,
    files: PendingUpload[],
    settings: z.infer<typeof volumeDescriptorSettingsSchema>,
    options?: CreateFromFilesOptions
  ): Promise<RawVolumeDataDB> {
    return (await super.createFromFiles(
      creatorId,
      volumeId,
      files,
      settings,
      options
    )) as RawVolumeDataDB;
  }

  static async createFromMrcFile(
    creatorId: number,
    volumeId: number,
    file: PendingUpload,
    client?: Prisma.TransactionClient
  ): Promise<RawVolumeDataDB> {
    return await Volume.withWriteLock(volumeId, [this.modelName], async () => {
      await fsPromises.mkdir(RawVolumeData.mrcTempDirectory, {
        recursive: true,
      });
      const tempDirectory = await fsPromises.mkdtemp(
        RawVolumeData.mrcTempDirectory
      );

      try {
        /* Save to temporary directory and perform operations there 
                    so we don't clog up the database with long transaction. */
        const mrcFilePathTemp = await file.saveAs(tempDirectory);
        const { rawFileName, settings } = await Utils.mrcToRaw(
          mrcFilePathTemp,
          tempDirectory
        );
        return await withTransaction(client, async (tx) => {
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

          const volumeData = await tx.rawVolumeData.create({
            data: {
              creator: {
                connect: {
                  id: creatorId,
                },
              },
              volume: {
                connect: {
                  id: volumeId,
                },
              },
              ...RawVolumeData.fromSettingSchema(settings),
              dataFile: {
                create: {},
              },
              name: Utils.stripExtension(rawFileName),
            },
          });
          let folderPath: string | null = null;
          try {
            folderPath = await RawVolumeDataFile.createVolumeDataFolder(
              volumeData.dataFileId
            );
            const mrcFilePath = path.join(
              folderPath,
              path.basename(mrcFilePathTemp)
            );
            await fsPromises.rename(mrcFilePathTemp, mrcFilePath);
            const rawFilePath = path.join(folderPath, rawFileName);
            await fsPromises.rename(
              path.join(tempDirectory, rawFileName),
              rawFilePath
            );

            await tx.rawVolumeDataFile.update({
              where: {
                id: volumeData.dataFileId,
              },
              data: {
                path: folderPath,
                rawFilePath: rawFilePath,
                mrcFilePath: mrcFilePath,
              },
            });

            return volumeData;
          } catch (error) {
            if (folderPath != null) {
              await fsPromises.rm(folderPath, {
                recursive: true,
                force: true,
              });
            }
            throw error;
          }
        });
      } finally {
        await fsPromises.rm(tempDirectory, {
          recursive: true,
          force: true,
        });
      }
    });
  }

  static override async update(
    id: number,
    changes: Prisma.RawVolumeDataUpdateInput
  ): Promise<RawVolumeDataDB> {
    return (await super.update(id, changes)) as RawVolumeDataDB;
  }

  static override async del(
    id: number,
    client?: Prisma.TransactionClient
  ): Promise<RawVolumeDataDB> {
    return await withTransaction(client, async (tx) => {
      const rawVolumeData = await tx.rawVolumeData.delete({
        where: { id: id },
      });

      const dataFile = await tx.rawVolumeDataFile.delete({
        where: {
          id: rawVolumeData.dataFileId,
          rawVolumeData: {
            none: {},
          },
        },
      });
      if (dataFile) {
        await RawVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return rawVolumeData;
    });
  }

  static override async prepareDataForDownload(
    id: number,
    downloadRawFile = true,
    downloadSettingsFile = true,
    downloadMrcFile = false
  ) {
    const volumeData = await RawVolumeData.getWithData(id);

    const volume = await Volume.getById(volumeData.volumeId);

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
      const settings = RawVolumeData.toSettingSchema(volumeData, volume);
      const settingsJSON = JSON.stringify(settings, null, 4);
      archive.append(settingsJSON, {
        name: `${Utils.stripExtension(settings.file)}.json`,
      });
      hasFiles = true;
    }
    if (downloadMrcFile && volumeData.dataFile.mrcFilePath != null) {
      archive.file(volumeData.dataFile.mrcFilePath, {
        name: path.basename(volumeData.dataFile.mrcFilePath),
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
