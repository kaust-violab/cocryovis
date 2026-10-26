// @ts-check

import { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import { MissingResourceError } from "../tools/error-handler";
import fs from "fs";
import appConfig from "../tools/config";
import path from "path";
import { Prisma } from "@prisma/client";
import VolumeDataFile from "./volume-data-file";

/**
 * @typedef { import("@prisma/client").PseudoVolumeDataFile } PseudoVolumeDataFileDB
 */

export default class PseudoVolumeDataFile extends VolumeDataFile {
  static modelName = "pseudoVolumeDataFile";

  static get db() {
    return prismaManager.db.pseudoVolumeDataFile;
  }

  static get folderPath() {
    return "pseudo-labeled-volume-data";
  }

  /**
   * @param {number} id
   */
  static async getById(id) {
    const entry = await this.db.findUnique({
      where: { id: id },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  /**
   * @param {import("@prisma/client").Prisma.PseudoVolumeDataFileCreateInput} data
   */
  static async create(data) {
    return await this.db.create({
      data: data,
    });
  }

  /**
   * @param {number} id
   */
  static async createVolumeDataFolder(id) {
    const folderPath = path.join(
      appConfig.dataPath,
      this.volumeDataFolder,
      this.folderPath,
      id.toString()
    );
    if (fs.existsSync(folderPath)) {
      if (appConfig.safeMode) {
        throw new Error(`Volume directory already exists`);
      } else {
        await fs.promises.rm(folderPath, {
          recursive: true,
          force: true,
        });
      }
    }
    fs.mkdirSync(folderPath, { recursive: true });
    return folderPath;
  }

  /**
   * @param {number} id
   * @param {import("@prisma/client").Prisma.PseudoVolumeDataFileUpdateInput} changes
   * @returns {Promise<PseudoVolumeDataFileDB>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {number} id
   * @returns { Promise<PseudoVolumeDataFileDB> }
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async del(id, client) {
    return await withTransaction(client, async (tx) => {
      const dataFile = await tx.pseudoVolumeDataFile.delete({
        where: {
          id: id,
          pseudoLabelVolumeData: {
            none: {},
          },
        },
      });
      if (dataFile) {
        PseudoVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return dataFile;
    });
  }

  /**
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async deleteZombies(client) {
    return await withTransaction(client, async (tx) => {
      const pseudoFiles = await tx.pseudoVolumeDataFile.findMany({
        where: {
          pseudoLabelVolumeData: {
            none: {},
          },
        },
        select: { id: true, path: true },
      });

      const ids = pseudoFiles.map((f) => f.id);

      for (const rawfile of pseudoFiles) {
        await PseudoVolumeDataFile.removeFilesFromDisc(rawfile);
      }
      await tx.pseudoVolumeDataFile.deleteMany({
        where: {
          id: { in: ids },
        },
      });
    });
  }

  /**
   * @param {{path:string}} data
   */
  static async removeFilesFromDisc(data) {
    fs.promises.rm(data.path, { force: true, recursive: true });
  }
}
