// @ts-check

import path from "path";
import Utils from "../tools/utils.mjs";
import VolumeData from "./volume-data.mjs";
import prismaManager from "../tools/prisma-manager.mjs";
import fsPromises from "node:fs/promises";
import { PendingUpload } from "../tools/file-handler.mjs";
import WriteLockManager from "../tools/write-lock-manager.mjs";
import Volume from "./volume.mjs";
import { ApiError } from "../tools/error-handler.mjs";
import appConfig from "../tools/config.mjs";
import { ZipArchive } from "archiver";
import RawVolumeDataFile from "./raw-volume-data-file.mjs";
import { withTransaction } from "./database-model.mjs";
import { Prisma } from "@prisma/client";

/**
 * @import z from "zod"
 * @import { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
 * @import { volumeDescriptorSettingsSchema } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
 * @typedef { import("@prisma/client").RawVolumeData } RawVolumeDataDB
 */

/**
 * @augments {VolumeData}
 */
export default class RawVolumeData extends VolumeData {
  static modelName = "rawVolumeData";
  static fileModelName = "rawVolumeDataFile";
  static lockManager = new WriteLockManager(this.modelName);
  static mrcTempDirectory = path.join(appConfig.tempPath, "mrc");
  static fileClass = RawVolumeDataFile;

  static get db() {
    return prismaManager.db.rawVolumeData;
  }

  /**
   * @param {number} id
   * @returns {Promise<RawVolumeDataDB>}
   */
  static async getById(id) {
    return await super.getById(id);
  }

  /**
   * @param {number} id
   */
  static async getWithData(id) {
    const volumeData = await this.db.findUniqueOrThrow({
      where: { id: id },
      include: {
        dataFile: true,
      },
    });
    return volumeData;
  }

  /**
   * @param {number} id
   * @returns {Promise<RawVolumeDataDB>}
   */
  static async getFromVolumeId(id) {
    const volumeData = await this.db.findUnique({
      where: { volumeId: id },
    });
    return volumeData;
  }

  /**
   * @param {number} id
   */
  static async getFromVolumeIdWithData(id) {
    const volumeData = await this.db.findUnique({
      where: { volumeId: id },
      include: { dataFile: true },
    });
    return volumeData;
  }

  /**
   * @param {number} creatorId
   * @param {number} volumeId
   * @returns {Promise<RawVolumeDataDB>}
   */
  static async create(creatorId, volumeId) {
    return await super.create(creatorId, volumeId);
  }

  /**
   * @param {number} creatorId
   * @param {number} volumeId
   * @param {PendingUpload[]} files
   * @param {z.infer<typeof volumeDescriptorSettingsSchema>} settings
   * @param {{ skipLock?: boolean, client?: Prisma.TransactionClient, reconstructionParameters?: z.infer<tiltSeriesOptions> }} [options]
   * @returns {Promise<RawVolumeDataDB>}
   */
  static async createFromFiles(creatorId, volumeId, files, settings, options) {
    return await super.createFromFiles(
      creatorId,
      volumeId,
      files,
      settings,
      options
    );
  }

  /**
   * @param {number} creatorId
   * @param {number} volumeId
   * @param {PendingUpload} file
   * @param {Prisma.TransactionClient | undefined} [client]
   * @returns {Promise<RawVolumeDataDB>}
   */
  static async createFromMrcFile(creatorId, volumeId, file, client) {
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

          /** @type {RawVolumeDataDB} */
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
          let folderPath = null;
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

  /**
   * @param {number} id
   * @param {import("@prisma/client").Prisma.RawVolumeDataUpdateInput} changes
   * @returns {Promise<RawVolumeDataDB>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {number} id
   * @param {Prisma.TransactionClient | undefined} [client]
   * @returns {Promise<RawVolumeDataDB>}
   */
  static async del(id, client) {
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

  /**
   * @param {number} id
   * @param {boolean} downloadRawFile
   * @param {boolean} downloadSettingsFile
   * @param {boolean} downloadMrcFile
   */
  static async prepareDataForDownload(
    id,
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
        name: `${Utils.stripExtension(volumeData.dataFile.rawFilePath)}.json`,
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

    const outputFileName = `${this.modelName}_${Utils.stripExtension(
      volumeData.dataFile.path
    )}`;

    return {
      name: `${outputFileName}.zip`,
      archive: archive,
    };
  }
}
