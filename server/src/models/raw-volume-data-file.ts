import { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import { MissingResourceError } from "../tools/error-handler";
import fs from "fs";
import appConfig from "../tools/config";
import path from "path";
import type {
  Prisma,
  RawVolumeDataFile as PrismaRawVolumeDataFile,
} from "@prisma/client";
import VolumeDataFile from "./volume-data-file";

export type RawVolumeDataFileDB = PrismaRawVolumeDataFile;

export default class RawVolumeDataFile extends VolumeDataFile {
  static override modelName = "rawVolumeDataFile";

  static override get db() {
    return prismaManager.db.rawVolumeDataFile;
  }

  static readonly folderPath = "raw-data";

  static override async getById(id: number) {
    const entry = await this.db.findUnique({
      where: { id: id },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  static override async create(data: Prisma.RawVolumeDataFileCreateInput) {
    return await this.db.create({
      data: data,
    });
  }

  static async createVolumeDataFolder(id: number) {
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

  static override async update(
    id: number,
    changes: Prisma.RawVolumeDataFileUpdateInput
  ): Promise<RawVolumeDataFileDB> {
    return (await super.update(id, changes)) as RawVolumeDataFileDB;
  }

  static override async del(
    id: number,
    client?: Prisma.TransactionClient
  ): Promise<RawVolumeDataFileDB> {
    return await withTransaction(client, async (tx) => {
      const dataFile = await tx.rawVolumeDataFile.delete({
        where: {
          id: id,
          rawVolumeData: {
            none: {},
          },
        },
      });
      if (dataFile) {
        void RawVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return dataFile;
    });
  }
  static async deleteZombies(client?: Prisma.TransactionClient) {
    await withTransaction(client, async (tx) => {
      const rawFiles = await tx.rawVolumeDataFile.findMany({
        where: {
          rawVolumeData: {
            none: {},
          },
        },
        select: { id: true, path: true },
      });

      const ids = rawFiles.map((f) => f.id);

      for (const rawfile of rawFiles) {
        await RawVolumeDataFile.removeFilesFromDisc(rawfile);
      }
      await tx.rawVolumeDataFile.deleteMany({
        where: {
          id: { in: ids },
        },
      });
    });
  }

  static removeFilesFromDisc(data: { path: string | null }): Promise<void> {
    if (data.path) {
      void fs.promises.rm(data.path, { force: true, recursive: true });
    }
    return Promise.resolve();
  }
}
