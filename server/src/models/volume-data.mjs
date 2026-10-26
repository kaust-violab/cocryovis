// @ts-check

import path from "path";
import fsPromises from "node:fs/promises";
import fileSystem from "fs";
import DatabaseModel, { withTransaction } from "./database-model.mjs";
import appConfig from "../tools/config.mjs";
import Utils from "../tools/utils.mjs";
import { PendingUpload } from "../tools/file-handler.mjs";
import { ApiError } from "../tools/error-handler.mjs";
import { ZipArchive } from "archiver";
import { Prisma } from "@prisma/client";
import prismaManager from "../tools/prisma-manager.mjs";

/**
 * @import z from "zod"
 * @import { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
 * @import { volumeDescriptorSettingsSchema, volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
 * @typedef { import("@prisma/client").RawVolumeData } RawVolumeDataDB
 * @typedef { import("@prisma/client").SparseLabelVolumeData } SparseLabelVolumeDataDB
 * @typedef { import("@prisma/client").PseudoLabelVolumeData } PseudoLabelVolumeDataDB
 * @typedef { RawVolumeDataDB | SparseLabelVolumeDataDB | PseudoLabelVolumeDataDB } VolumeDataDB
 * @typedef { import("@prisma/client").RawVolumeDataFile } RawVolumeDataFileDB
 * @typedef { import("@prisma/client").SparseVolumeDataFile } SparseVolumeDataFileDB
 * @typedef { import("@prisma/client").PseudoVolumeDataFile } PseudoVolumeDataFileDB
 * @typedef { RawVolumeDataFileDB | SparseVolumeDataFileDB | PseudoVolumeDataFileDB } DataFileDB
 * @typedef { RawVolumeDataDB & {dataFile: RawVolumeDataFileDB }}  RawVolumeDataWithFileDB
 * @typedef { SparseLabelVolumeDataDB & {dataFile: SparseVolumeDataFileDB }} SparseVolumeDataWithFileDB
 * @typedef { PseudoLabelVolumeDataDB & {dataFile: PseudoVolumeDataFileDB }} PseudoVolumeDataWithFileDB
 * @typedef { RawVolumeDataWithFileDB | SparseVolumeDataWithFileDB | PseudoVolumeDataWithFileDB} VolumeDataWithFile
 * @typedef { import("@prisma/client").Volume } VolumeDB
 */

export const volumeDataFolder = "volume-data";

/**
 * @augments {DatabaseModel}
 */
export default class VolumeData extends DatabaseModel {
  static rawFileExtensions = [".raw"];
  static settingFileExtensions = [".json"];
  static acceptedFileExtensions = this.rawFileExtensions.concat(
    this.settingFileExtensions
  );
  static fileModelName = "";
  static fileClass;

  /**
   * @param {VolumeDataDB & {dataFile: {rawFilePath: string}}} volumeData
   * @param { PhysicalDimensions } physicalDimensions
   * @returns {z.infer<typeof volumeSettings>}
   */
  static toSettingSchema(volumeData, physicalDimensions) {
    return {
      file: path.basename(volumeData.dataFile.rawFilePath),
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

  /**
   * @param {z.infer<typeof volumeDescriptorSettingsSchema>} settings
   */
  static fromSettingSchema(settings) {
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

  /**
   * @returns {string}
   */
  static get folderPath() {
    throw new Error("Method not implemented");
  }

  /**
   * @param {number} id
   * @returns {Promise<any>}
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
   * @param {number} volumeDataId
   * @param {number} volumeId
   * @returns {Promise<boolean>}
   */
  static async belongsToVolume(volumeDataId, volumeId) {
    const volumeData = await this.db.findUnique({
      where: { id: volumeDataId },
      include: {
        volumes: true,
      },
    });
    if (!volumeData || !volumeData.volumes.some((v) => v.id === volumeId)) {
      return false;
    }
    return true;
  }

  /**
   * @param {number} creatorId
   * @param {number} volumeId
   * @param {PendingUpload[]} files
   * @param {z.infer<typeof volumeDescriptorSettingsSchema>} settings
   * @param {{ skipLock?: boolean, client?: Prisma.TransactionClient, reconstructionParameters?: z.infer<tiltSeriesOptions> }} [options]
   * @returns {Promise<object>}
   */
  static async createFromFiles(
    creatorId,
    volumeId,
    files,
    settings,
    { skipLock = false, client, reconstructionParameters } = {}
  ) {
    // Temporary fix to avoid circular dependency.
    const { default: Volume } = await import("./volume.mjs");

    return await Volume.withWriteLock(
      volumeId,
      [this.modelName],
      async () => {
        let rawFile = files.find((f) =>
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

          if (volume.rawData === undefined) {
            await tx.volume.update({
              where: {
                id: volumeId,
              },
              data: {
                physicalUnit: settings.physicalUnit,
                physicalSizeX: settings.physicalSize.x,
                physicalSizeY: settings.physicalSize.y,
                physicalSizeZ: settings.physicalSize.y,
              },
            });
          }

          /** @type {VolumeDataDB} */
          const volumeData = await tx[this.modelName].create({
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
          let folderPath = null;
          try {
            folderPath = await this.fileClass.createVolumeDataFolder(
              volumeData.id
            );
            const rawFilePath = await rawFile.saveAs(folderPath);

            await tx[this.fileModelName].update({
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

  /**
   * @param {number} id
   * @param {any} changes
   * @returns {Promise<object>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {string} settingsString
   * @param {string?} rawFilePath
   */
  static async parseSettings(settingsString, rawFilePath = null) {
    const settings = JSON.parse(settingsString);
    if (rawFilePath) {
      settings["file"] = path.basename(rawFilePath);
    }
    if (!Object.hasOwn(settings, "transferFunction")) {
      settings["transferFunction"] = "tf-default.json";
    }
    return JSON.stringify(settings);
  }

  /**
   * @param {string} folderPath
   * @param {string} fileName
   */
  static checkFilePath(folderPath, fileName) {
    let fileNameOverride = null;
    const potentialSettingFilePath = path.join(folderPath, fileName);
    if (fileSystem.existsSync(potentialSettingFilePath)) {
      fileNameOverride = Utils.generateUniqueFileName(potentialSettingFilePath);
    }
    return fileNameOverride;
  }

  /**
   * @param {number} id
   * @param {boolean} downloadRawFile
   * @param {boolean} downloadSettingsFile
   */
  static async prepareDataForDownload(
    id,
    downloadRawFile = true,
    downloadSettingsFile = true
  ) {
    /**@type {VolumeDataWithFile} */
    const volumeData = await this.getWithData(id);

    const volume = await prismaManager.db.volume.findUnique({
      where: { id: volumeData.volumeId },
    });

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
        name: `${Utils.stripExtension(volumeData.dataFile.rawFilePath)}.json`,
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
