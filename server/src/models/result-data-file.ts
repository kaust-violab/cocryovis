import DatabaseModel, { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import path from "path";
import appConfig from "../tools/config";
import fs from "fs";
import { ApiError } from "../tools/error-handler";
import type {
  Prisma,
  ResultDataFile as PrismaResultDataFile,
} from "@prisma/client";

export type ResultDataFileDB = PrismaResultDataFile;

export default class ResultDataFile extends DatabaseModel {
  static override modelName = "resultDataFile";
  static resultsFolder = "results";

  static override get db() {
    return prismaManager.db.resultDataFile;
  }

  static override async getById(id: number): Promise<ResultDataFileDB> {
    return (await super.getById(id)) as ResultDataFileDB;
  }

  static override create() {
    return Promise.reject(
      new ApiError(500, "Direct creation of result data files is not allowed")
    );
  }

  static override del(_id: number): Promise<ResultDataFileDB> {
    return Promise.reject(
      new ApiError(500, "Direct deletion of result data files is not allowed")
    );
  }

  static async createDirectory(id: number): Promise<string> {
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

  static async deleteZombies(client?: Prisma.TransactionClient) {
    await withTransaction(client, async (tx) => {
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
            `Error deleting result volume directory during zombie cleanup: ${(fsError as Error).message}`
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
