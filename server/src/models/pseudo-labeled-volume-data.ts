// @ts-check

import VolumeData from "./volume-data";
import prismaManager from "../tools/prisma-manager";
import fsPromises from "fs/promises";
import path from "path";
import WriteLockManager from "../tools/write-lock-manager";

import { PendingUpload } from "../tools/file-handler";
import PseudoVolumeDataFile from "./pseudo-volume-data-file";
import Utils from "../tools/utils";
import { Prisma } from "@prisma/client";
import { withTransaction } from "./database-model";

/**
 * @import z from "zod"
 * @import { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
 * @import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
 * @typedef { import("@prisma/client").PseudoLabelVolumeData } PseudoVolumeDataDB
 */

/**
 * @augments {VolumeData}
 */
export default class PseudoLabeledVolumeData extends VolumeData {
  static modelName = "pseudoLabelVolumeData";
  static fileModelName = "pseudoVolumeDataFile";
  static lockManager = new WriteLockManager(this.modelName);
  static fileClass = PseudoVolumeDataFile;

  static get db() {
    return prismaManager.db.pseudoLabelVolumeData;
  }

  /**
   * @param {number} id
   * @returns {Promise<PseudoVolumeDataDB>}
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
   * @param {number} creatorId
   * @param {number} volumeId
   * @returns {Promise<PseudoVolumeDataDB>}
   */
  static async create(creatorId, volumeId) {
    return await super.create(creatorId, volumeId);
  }

  /**
   * @param {number} creatorId
   * @param {number} volumeId
   * @param {PendingUpload[]} files
   * @param {z.infer<typeof volumeSettings>} settings
   * @param {{ skipLock?: boolean, client?: Prisma.TransactionClient, reconstructionParameters?: z.infer<tiltSeriesOptions> }} [options]
   * @returns {Promise<PseudoVolumeDataDB>}
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
   * @param {number} id
   * @param {import("@prisma/client").Prisma.PseudoLabelVolumeDataUpdateInput} changes
   * @returns {Promise<PseudoVolumeDataDB>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {number} id
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async del(id, client) {
    return await withTransaction(client, async (tx) => {
      const volumeData = await tx.pseudoLabelVolumeData.delete({
        where: { id: id },
      });

      const dataFile = await tx.pseudoVolumeDataFile.delete({
        where: {
          id: volumeData.dataFileId,
          pseudoLabelVolumeData: {
            none: {},
          },
        },
      });
      if (dataFile) {
        await PseudoVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return volumeData;
    });
  }

  /**
   * @param {string} filePath
   * @param {number} creatorId
   * @param {number} volumeId
   * @param {number} originalLabelId
   * @param {CommonVolumeSettings} settings
   * @param {import("@prisma/client").Prisma.TransactionClient} client
   * @returns {Promise<import("./volume-data").PseudoVolumeDataWithFileDB>}
   */
  static async fromRawFile(
    filePath,
    creatorId,
    volumeId,
    originalLabelId,
    settings,
    client = prismaManager.db
  ) {
    const fileName = path.basename(filePath);
    let pseudoVolume = await client.pseudoLabelVolumeData.create({
      data: {
        creator: {
          connect: {
            id: creatorId,
          },
        },
        originalLabel: {
          connect: {
            id: originalLabelId,
          },
        },
        sizeX: settings.sizeX,
        sizeY: settings.sizeY,
        sizeZ: settings.sizeZ,
        skipBytes: settings.skipBytes,
        isLittleEndian: settings.isLittleEndian,
        isSigned: settings.isSigned,
        addValue: settings.addValue,
        bytesPerVoxel: settings.bytesPerVoxel,
        usedBits: settings.usedBits,
        volume: {
          connect: {
            id: volumeId,
          },
        },
        dataFile: {
          create: {},
        },
        name: Utils.stripExtension(fileName),
      },
      include: { dataFile: true },
    });

    const folderPath = await PseudoVolumeDataFile.createVolumeDataFolder(
      pseudoVolume.dataFileId
    );

    const newFilePath = path.join(folderPath, fileName);
    await fsPromises.rename(filePath, newFilePath);
    let dataFile = null;
    try {
      dataFile = await client.pseudoVolumeDataFile.update({
        where: { id: pseudoVolume.id },
        data: {
          path: folderPath,
          rawFilePath: newFilePath,
        },
      });
    } catch (error) {
      try {
        if (dataFile) {
          await PseudoVolumeDataFile.removeFilesFromDisc(dataFile);
        }
      } catch (err) {
        console.error(
          `Failed to delete volume data folder on failed operation:\n${err}`
        );
      }
      throw error;
    }

    return pseudoVolume;
  }
}
