import { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import { MissingResourceError } from "../tools/error-handler";
import fs from "fs";
import appConfig from "../tools/config";
import path from "path";
import type {
  Prisma,
  PseudoVolumeDataFile as PrismaPseudoVolumeDataFile,
} from "@prisma/client";
import VolumeDataFile from "./volume-data-file";

export type PseudoVolumeDataFileDB = PrismaPseudoVolumeDataFile;

export default class PseudoVolumeDataFile extends VolumeDataFile {
  static override modelName = "pseudoVolumeDataFile";

  static override get db() {
    return prismaManager.db.pseudoVolumeDataFile;
  }

  static readonly folderPath = "pseudo-labeled-volume-data";

  static override async getById(id: number) {
    const entry = await this.db.findUnique({
      where: { id: id },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  static override async create(data: Prisma.PseudoVolumeDataFileCreateInput) {
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
    changes: Prisma.PseudoVolumeDataFileUpdateInput
  ): Promise<PseudoVolumeDataFileDB> {
    return (await super.update(id, changes)) as PseudoVolumeDataFileDB;
  }

  static override async del(
    id: number,
    client?: Prisma.TransactionClient
  ): Promise<PseudoVolumeDataFileDB> {
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
        void PseudoVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return dataFile;
    });
  }

  static async deleteZombies(client?: Prisma.TransactionClient) {
    await withTransaction(client, async (tx) => {
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

  static removeFilesFromDisc(data: { path: string | null }): Promise<void> {
    if (data.path) {
      void fs.promises.rm(data.path, { force: true, recursive: true });
    }
    return Promise.resolve();
  }
}
