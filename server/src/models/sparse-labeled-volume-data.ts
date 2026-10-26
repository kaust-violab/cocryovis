// @ts-check

import VolumeData from "./volume-data";
import prismaManager from "../tools/prisma-manager";
import fsPromises from "fs/promises";
import path from "path";
import WriteLockManager from "../tools/write-lock-manager";
import Utils from "../tools/utils";
import SparseVolumeDataFile from "./sparse-volume-data-file";
import { Prisma } from "@prisma/client";
import { withTransaction } from "./database-model";

/**
 * @import z from "zod"
 * @import { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
 * @import { PendingUpload } from "../tools/file-handler";
 * @import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
 * @typedef { import("@prisma/client").SparseLabelVolumeData } SparseLabelVolumeDataDB
 */

/**
 * @augments {VolumeData}
 */
export default class SparseLabeledVolumeData extends VolumeData {
  static modelName = "sparseLabelVolumeData";
  static fileModelName = "sparseVolumeDataFile";
  static lockManager = new WriteLockManager(this.modelName);
  static fileClass = SparseVolumeDataFile;

  static get db() {
    return prismaManager.db.sparseLabelVolumeData;
  }

  /**
   * @param {number} id
   * @returns {Promise<SparseLabelVolumeDataDB>}
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
   * @returns {Promise<SparseLabelVolumeDataDB>}
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
   * @returns {Promise<SparseLabelVolumeDataDB>}
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
   * @param {import("@prisma/client").Prisma.SparseLabelVolumeDataUpdateInput} changes
   * @returns {Promise<SparseLabelVolumeDataDB>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {number} id
   * @param {Prisma.TransactionClient | undefined} [client]
   * @returns {Promise<SparseLabelVolumeDataDB>}
   */
  static async del(id, client) {
    return await withTransaction(client, async (tx) => {
      const VolumeData = await tx.sparseLabelVolumeData.delete({
        where: { id: id },
      });

      const dataFile = await tx.sparseVolumeDataFile.delete({
        where: {
          id: VolumeData.dataFileId,
          sparseLabelVolumeData: {
            none: {},
          },
        },
      });
      if (dataFile) {
        await SparseVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return VolumeData;
    });
  }

  /**
   * @param {string} filePath
   * @param {number} creatorId
   * @param {number} volumeId
   * @param {z.infer<typeof volumeSettings>} settings
   * @param {import("@prisma/client").Prisma.TransactionClient} tx
   * @returns {Promise<SparseLabelVolumeDataDB>}
   */
  static async fromRawFile(
    filePath,
    creatorId,
    volumeId,
    settings,
    tx = prismaManager.db
  ) {
    const fileName = path.basename(filePath);
    let sparseVolume = await tx.sparseLabelVolumeData.create({
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
        ...SparseLabeledVolumeData.fromSettingSchema(settings),
        dataFile: {
          create: {},
        },
        name: Utils.stripExtension(fileName),
      },
    });

    const folderPath = await SparseVolumeDataFile.createVolumeDataFolder(
      sparseVolume.dataFileId
    );
    const newFilePath = path.join(folderPath, fileName);
    await fsPromises.rename(filePath, newFilePath);
    let dataFile = null;
    try {
      dataFile = await tx.sparseVolumeDataFile.update({
        where: { id: sparseVolume.id },
        data: {
          path: folderPath,
          rawFilePath: newFilePath,
        },
      });
    } catch (error) {
      try {
        if (dataFile) {
          await SparseVolumeDataFile.removeFilesFromDisc(dataFile);
        }
      } catch (err) {
        console.error(
          `Failed to delete volume data folder on failed operation:\n${err}`
        );
      }
      throw error;
    }

    return sparseVolume;
  }

  /**
   * @param {number} id
   * @param {PendingUpload} file
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async setRawData(id, file, client) {
    return await withTransaction(client, async (tx) => {
      const volumeData = await tx.sparseLabelVolumeData.findUniqueOrThrow({
        where: { id: id },
        include: {
          dataFile: {
            include: { sparseLabelVolumeData: true },
          },
        },
      });
      if (volumeData.dataFile.sparseLabelVolumeData.length === 1) {
        await SparseVolumeDataFile.updateFromFile(
          file,
          volumeData.dataFile,
          tx
        );
        return volumeData;
      } else {
        const fileData = await SparseVolumeDataFile.createFromFile(file, tx);
        return await tx.sparseLabelVolumeData.update({
          where: { id: id },
          data: {
            id: fileData.id,
          },
        });
      }
    });
  }
}
