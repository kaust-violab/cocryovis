// @ts-check

import DatabaseModel, { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import path from "path";
import appConfig from "../tools/config";
import fs from "fs";
import { ApiError } from "../tools/error-handler";
import { Prisma } from "@prisma/client";

/**
 * @typedef { import("@prisma/client").ResultDataFile } ResultDataFileDB
 * @import z from "zod"
 */

export default class ResultDataFile extends DatabaseModel {
  static modelName = "resultDataFile";
  static resultsFolder = "results";

  static get db() {
    return prismaManager.db.resultDataFile;
  }

  /**
   * @param {number} id
   * @returns {Promise<ResultDataFileDB>}
   */
  static async getById(id) {
    return await super.getById(id);
  }

  static async create() {
    throw new ApiError(
      500,
      "Direct creation of result data files is not allowed"
    );
  }

  /**
   * @param {number} _id
   * @returns {Promise<ResultDataFileDB>}
   */
  static async del(_id) {
    throw new ApiError(
      500,
      "Direct deletion of result data files is not allowed"
    );
  }

  /**
   * @param {number} id
   * @returns {Promise<string>}
   */
  static async createDirectory(id) {
    const resultsFolderPath = path.join(appConfig.dataPath, this.resultsFolder);
    const folderPath = path.join(resultsFolderPath, id.toString());
    if (fs.existsSync(folderPath)) {
      if (appConfig.safeMode) {
        throw new ApiError(500, `Result directory already exists`);
      } else {
        await fs.promises.rm(folderPath, {
          recursive: true,
          force: true,
        });
      }
    }
    await fs.promises.mkdir(folderPath, { recursive: true });

    return folderPath;
  }

  /**
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async deleteZombies(client) {
    return await withTransaction(client, async (tx) => {
      const dataFiles = await tx.resultDataFile.findMany({
        where: {
          resultVolumes: {
            none: {},
          },
        },
        select: { id: true, path: true },
      });

      const ids = dataFiles.map((file) => file.id);

      for (const dataFile of dataFiles) {
        try {
          if (dataFile.path) {
            await fs.promises.rm(dataFile.path, {
              recursive: true,
              force: true,
            });
          }
        } catch (fsError) {
          console.error(
            `Error deleting result volume directory during zombie cleanup: ${fsError.message}`
          );
        }
      }

      await tx.resultDataFile.deleteMany({
        where: {
          id: { in: ids },
        },
      });
    });
  }
}
