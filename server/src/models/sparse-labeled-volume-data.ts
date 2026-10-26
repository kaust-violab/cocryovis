import VolumeData, { type CreateFromFilesOptions } from "./volume-data";
import prismaManager from "../tools/prisma-manager";
import fsPromises from "fs/promises";
import path from "path";
import WriteLockManager from "../tools/write-lock-manager";
import Utils from "../tools/utils";
import SparseVolumeDataFile from "./sparse-volume-data-file";
import type { Prisma } from "@prisma/client";
import type z from "zod";
import type { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import { withTransaction } from "./database-model";
import type { PendingUpload } from "../tools/file-handler";

export default class SparseLabeledVolumeData extends VolumeData {
  static override modelName = "sparseLabelVolumeData";
  static override fileModelName = "sparseVolumeDataFile";
  static override lockManager = new WriteLockManager(this.modelName);
  static override fileClass = SparseVolumeDataFile;

  static override get db() {
    return prismaManager.db.sparseLabelVolumeData;
  }

  static override async getById(id: number): Promise<SparseLabelVolumeDataDB> {
    return (await super.getById(id)) as SparseLabelVolumeDataDB;
  }

  static override async getWithData(id: number) {
    const volumeData = await this.db.findUniqueOrThrow({
      where: { id: id },
      include: {
        dataFile: true,
      },
    });
    return volumeData;
  }

  static override async create(
    creatorId: number,
    volumeId: number
  ): Promise<SparseLabelVolumeDataDB> {
    return (await super.create(creatorId, volumeId)) as SparseLabelVolumeDataDB;
  }

  static override async createFromFiles(
    creatorId: number,
    volumeId: number,
    files: PendingUpload[],
    settings: z.infer<typeof volumeSettings>,
    options?: CreateFromFilesOptions
  ): Promise<SparseLabelVolumeDataDB> {
    return (await super.createFromFiles(
      creatorId,
      volumeId,
      files,
      settings,
      options
    )) as SparseLabelVolumeDataDB;
  }

  static override async update(
    id: number,
    changes: Prisma.SparseLabelVolumeDataUpdateInput
  ): Promise<SparseLabelVolumeDataDB> {
    return (await super.update(id, changes)) as SparseLabelVolumeDataDB;
  }

  static override async del(
    id: number,
    client?: Prisma.TransactionClient
  ): Promise<SparseLabelVolumeDataDB> {
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

  static async fromRawFile(
    filePath: string,
    creatorId: number,
    volumeId: number,
    settings: z.infer<typeof volumeSettings>,
    tx: Prisma.TransactionClient = prismaManager.db
  ): Promise<SparseLabelVolumeDataDB> {
    const fileName = path.basename(filePath);
    const sparseVolume = await tx.sparseLabelVolumeData.create({
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
    let dataFile: { path: string | null } | null = null;
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
          `Failed to delete volume data folder on failed operation:\n${String(err)}`
        );
      }
      throw error;
    }

    return sparseVolume;
  }

  static async setRawData(
    id: number,
    file: PendingUpload,
    client?: Prisma.TransactionClient
  ) {
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
