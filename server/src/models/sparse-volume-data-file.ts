import { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import { ApiError, MissingResourceError } from "../tools/error-handler";
import fs from "fs";
import appConfig from "../tools/config";
import path from "path";
import type { PendingUpload } from "../tools/file-handler";
import type {
  Prisma,
  SparseVolumeDataFile as PrismaSparseVolumeDataFile,
} from "@prisma/client";
import VolumeDataFile from "./volume-data-file";

export type SparseVolumeDataFileDB = PrismaSparseVolumeDataFile;

export default class SparseVolumeDataFile extends VolumeDataFile {
  static override modelName = "sparseVolumeDataFile";

  static override get db() {
    return prismaManager.db.sparseVolumeDataFile;
  }

  static readonly folderPath = "sparse-labeled-volume-data";

  static override async getById(id: number) {
    const entry = await this.db.findUnique({
      where: { id: id },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
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

  static override async create(
    data: Prisma.SparseVolumeDataFileCreateInput,
    client?: Prisma.TransactionClient
  ) {
    return await withTransaction(client, async (tx) => {
      const fileData = await tx.sparseVolumeDataFile.create({
        data: {
          rawFilePath: data.rawFilePath,
        },
      });
      let folderPath: string | null = null;
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

  static async createFromFile(
    file: PendingUpload,
    client?: Prisma.TransactionClient
  ) {
    return await withTransaction(client, async (tx) => {
      const fileData = await tx.sparseVolumeDataFile.create({
        data: {},
      });
      let folderPath: string | null = null;
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

  static async updateFromFile(
    file: PendingUpload,
    dataFile: PrismaSparseVolumeDataFile,
    client?: Prisma.TransactionClient
  ) {
    const rawFilePath = dataFile.rawFilePath;
    const folderPath = dataFile.path;
    if (!rawFilePath || !folderPath) {
      throw new ApiError(
        500,
        `Sparse volume data file ${dataFile.id.toString()} has no files on disk.`
      );
    }
    return await withTransaction(client, async (tx) => {
      let fileNameOverride = file.fileName;
      if (fileNameOverride === path.basename(rawFilePath)) {
        const parsedName = path.parse(file.fileName);
        fileNameOverride = parsedName.name + "-new" + parsedName.ext;
      }
      try {
        const newRawFilePath = await file.saveAs(folderPath, fileNameOverride);
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
        void fs.promises.rm(path.join(folderPath, fileNameOverride), {
          recursive: true,
          force: true,
        });
        throw error;
      }
    });
  }
  static override async update(
    id: number,
    changes: Prisma.SparseVolumeDataFileUpdateInput
  ): Promise<SparseVolumeDataFileDB> {
    return (await super.update(id, changes)) as SparseVolumeDataFileDB;
  }

  static override async del(
    id: number,
    client?: Prisma.TransactionClient
  ): Promise<SparseVolumeDataFileDB> {
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
        void SparseVolumeDataFile.removeFilesFromDisc(dataFile);
      }
      return dataFile;
    });
  }

  static async deleteZombies(client?: Prisma.TransactionClient) {
    await withTransaction(client, async (tx) => {
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

  static removeFilesFromDisc(data: { path: string | null }): Promise<void> {
    if (data.path) {
      void fs.promises.rm(data.path, { force: true, recursive: true });
    }
    return Promise.resolve();
  }
}
