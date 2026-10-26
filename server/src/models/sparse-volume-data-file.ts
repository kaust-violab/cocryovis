// @ts-check

import { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import { MissingResourceError } from "../tools/error-handler";
import fs from "fs";
import appConfig from "../tools/config";
import path from "path";
import { PendingUpload } from "../tools/file-handler";
import { Prisma } from "@prisma/client";
import VolumeDataFile from "./volume-data-file";

/**
 * @typedef { import("@prisma/client").SparseVolumeDataFile }SparseVolumeDataFileDB
 */

export default class SparseVolumeDataFile extends VolumeDataFile {
  static modelName = "sparseVolumeDataFile";

  static get db() {
    return prismaManager.db.sparseVolumeDataFile;
  }

  static get folderPath() {
    return "sparse-labeled-volume-data";
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
   * @param {import("@prisma/client").Prisma.SparseVolumeDataFileCreateInput} data
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async create(data, client) {
    return await withTransaction(client, async (tx) => {
      let fileData = await tx.sparseVolumeDataFile.create({
        data: {
          rawFilePath: data.rawFilePath,
        },
      });
      let folderPath = null;
      try {
        folderPath = await this.createVolumeDataFolder(fileData.id);

        await tx.sparseVolumeDataFile.update({
          where: { id: fileData.id },
          data: {
            path: folderPath,
          },
        });
      } catch (error) {
        if (folderPath != null) {
          await fs.promises.rm(folderPath, {
            recursive: true,
            force: true,
          });
        }
        throw error;
      }
      return fileData;
    });
  }

  /**
   * @param {PendingUpload} file
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async createFromFile(file, client) {
    return await withTransaction(client, async (tx) => {
      let fileData = await tx.sparseVolumeDataFile.create({
        data: {},
      });
      let folderPath = null;
      try {
        folderPath = await this.createVolumeDataFolder(fileData.id);

        const newRawFilePath = await file.saveAs(folderPath);
        await tx.sparseVolumeDataFile.update({
          where: { id: fileData.id },
          data: {
            path: folderPath,
            rawFilePath: newRawFilePath,
          },
        });
      } catch (error) {
        if (folderPath != null) {
          await fs.promises.rm(folderPath, {
            recursive: true,
            force: true,
          });
        }
        throw error;
      }
      return fileData;
    });
  }

  /**
   * @param {PendingUpload} file
   * @param {import("@prisma/client").SparseVolumeDataFile } dataFile
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async updateFromFile(file, dataFile, client) {
    return await withTransaction(client, async (tx) => {
      const rawFilePath = dataFile.rawFilePath;
      let fileNameOverride = file.fileName;
      if (fileNameOverride === path.basename(rawFilePath)) {
        const parsedName = path.parse(file.fileName);
        fileNameOverride = parsedName.name + "-new" + parsedName.ext;
      }
      try {
        const newRawFilePath = await file.saveAs(
          dataFile.path,
          fileNameOverride
        );
        await tx.sparseVolumeDataFile.update({
          where: { id: dataFile.id },
          data: {
            rawFilePath: newRawFilePath,
          },
        });
        await fs.promises.rm(rawFilePath, {
          force: true,
          recursive: true,
        });
        return dataFile;
      } catch (error) {
        fs.promises.rm(path.join(dataFile.path, fileNameOverride), {
          recursive: true,
          force: true,
        });
        throw error;
      }
    });
  }
  /**
   * @param {number} id
   * @param {import("@prisma/client").Prisma.SparseVolumeDataFileUpdateInput} changes
   * @returns {Promise<SparseVolumeDataFileDB>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {number} id
   * @param {Prisma.TransactionClient | undefined} [client]
   * @returns { Promise<SparseVolumeDataFileDB> }
   */
  static async del(id, client) {
    return await withTransaction(client, async (tx) => {
      const dataFile = await tx.sparseVolumeDataFile.delete({
        where: {
          id: id,
          sparseLabelVolumeData: {
            none: {},
          },
        },
      });
      if (dataFile) {
        SparseVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return dataFile;
    });
  }

  /**
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async deleteZombies(client) {
    return await withTransaction(client, async (tx) => {
      const sparseFiles = await tx.sparseVolumeDataFile.findMany({
        where: {
          sparseLabelVolumeData: {
            none: {},
          },
        },
        select: { id: true, path: true },
      });

      const ids = sparseFiles.map((f) => f.id);

      for (const rawfile of sparseFiles) {
        await SparseVolumeDataFile.removeFilesFromDisc(rawfile);
      }
      await tx.sparseVolumeDataFile.deleteMany({
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
