import VolumeData, {
  type CreateFromFilesOptions,
  type PseudoVolumeDataWithFileDB,
} from "./volume-data";
import prismaManager from "../tools/prisma-manager";
import fsPromises from "fs/promises";
import path from "path";
import WriteLockManager from "../tools/write-lock-manager";
import type { PendingUpload } from "../tools/file-handler";
import PseudoVolumeDataFile from "./pseudo-volume-data-file";
import Utils from "../tools/utils";
import type { Prisma } from "@prisma/client";
import type z from "zod";
import type { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import { withTransaction } from "./database-model";

export default class PseudoLabeledVolumeData extends VolumeData {
  static override modelName = "pseudoLabelVolumeData";
  static override fileModelName = "pseudoVolumeDataFile";
  static override lockManager = new WriteLockManager(this.modelName);
  static override fileClass = PseudoVolumeDataFile;

  static override get db() {
    return prismaManager.db.pseudoLabelVolumeData;
  }

  static override async getById(id: number): Promise<PseudoLabelVolumeDataDB> {
    return (await super.getById(id)) as PseudoLabelVolumeDataDB;
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
  ): Promise<PseudoLabelVolumeDataDB> {
    return (await super.create(creatorId, volumeId)) as PseudoLabelVolumeDataDB;
  }

  static override async createFromFiles(
    creatorId: number,
    volumeId: number,
    files: PendingUpload[],
    settings: z.infer<typeof volumeSettings>,
    options?: CreateFromFilesOptions
  ): Promise<PseudoLabelVolumeDataDB> {
    return (await super.createFromFiles(
      creatorId,
      volumeId,
      files,
      settings,
      options
    )) as PseudoLabelVolumeDataDB;
  }

  static override async update(
    id: number,
    changes: Prisma.PseudoLabelVolumeDataUpdateInput
  ): Promise<PseudoLabelVolumeDataDB> {
    return (await super.update(id, changes)) as PseudoLabelVolumeDataDB;
  }

  static override async del(
    id: number,
    client?: Prisma.TransactionClient
  ): Promise<PseudoLabelVolumeDataDB> {
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

  static async fromRawFile(
    filePath: string,
    creatorId: number,
    volumeId: number,
    originalLabelId: number,
    settings: CommonVolumeSettings,
    client: Prisma.TransactionClient = prismaManager.db
  ): Promise<PseudoVolumeDataWithFileDB> {
    const fileName = path.basename(filePath);
    const pseudoVolume = await client.pseudoLabelVolumeData.create({
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
    try {
      await fsPromises.rename(filePath, newFilePath);
      const dataFile = await client.pseudoVolumeDataFile.update({
        where: { id: pseudoVolume.dataFileId },
        data: {
          path: folderPath,
          rawFilePath: newFilePath,
        },
      });
      return { ...pseudoVolume, dataFile };
    } catch (error) {
      try {
        await fsPromises.rm(folderPath, { recursive: true, force: true });
      } catch (err) {
        console.error(
          `Failed to delete volume data folder on failed operation:\n${String(err)}`
        );
      }
      throw error;
    }
  }
}
