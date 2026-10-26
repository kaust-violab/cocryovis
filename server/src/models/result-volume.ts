import DatabaseModel from "./database-model";
import prismaManager from "../tools/prisma-manager";
import path from "path";
import fs from "fs";
import { ApiError } from "../tools/error-handler";
import { PendingUpload } from "../tools/file-handler";
import ResultDataFile from "./result-data-file";
import type {
  Prisma,
  ResultVolume as PrismaResultVolume,
  ResultDataFile as PrismaResultDataFile,
} from "@prisma/client";
import type z from "zod";
import type { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";

export type ResultVolumeDB = PrismaResultVolume;
export type ResultVolumeWithFileDB = ResultVolumeDB & {
  dataFile: PrismaResultDataFile;
};

export default class ResultVolume extends DatabaseModel {
  static override modelName = "resultVolume";

  static override get db() {
    return prismaManager.db.resultVolume;
  }

  static override async getById(id: number): Promise<ResultVolumeDB> {
    return (await super.getById(id)) as ResultVolumeDB;
  }

  static override async create(
    resultId: number,
    file: string | PendingUpload,
    volumeParameters: Omit<
      Prisma.ResultVolumeCreateInput,
      "result" | "dataFile"
    >,
    client: Prisma.TransactionClient = prismaManager.db
  ): Promise<ResultVolumeDB> {
    let volume: ResultVolumeDB | undefined;
    let newDirectory: string | undefined;
    try {
      volume = await client.resultVolume.create({
        data: {
          ...volumeParameters,
          result: {
            connect: { id: resultId },
          },
          dataFile: {
            create: {},
          },
        },
      });

      newDirectory = await ResultDataFile.createDirectory(volume.id);
      let newFilePath: string;
      if (file instanceof PendingUpload) {
        newFilePath = await file.saveAs(newDirectory);
      } else {
        const filePath = path.resolve(file);
        newFilePath = path.join(newDirectory, path.basename(filePath));
        await fs.promises.rename(filePath, newFilePath);
      }

      await client.resultDataFile.update({
        where: { id: volume.dataFileId },
        data: {
          path: newDirectory,
          rawFilePath: newFilePath,
        },
      });
      return volume;
    } catch (error) {
      try {
        if (volume) {
          await client.resultVolume.delete({
            where: { id: volume.id },
          });
        }
      } catch (deleteError) {
        console.error(
          `Error rolling back result volume creation: ${(deleteError as Error).message}`
        );
      }
      if (newDirectory !== undefined) {
        try {
          await fs.promises.rm(newDirectory, {
            recursive: true,
            force: true,
          });
        } catch (fsError) {
          console.error(
            `Error rolling back result volume directory creation: ${(fsError as Error).message}`
          );
        }
      }
      throw new ApiError(
        500,
        `Error creating result volume: ${(error as Error).message}`
      );
    }
  }

  static override del(_id: number): Promise<ResultVolumeDB> {
    return Promise.reject(
      new Error(
        "Result Volume cannot be deleted manually. Delete Result instead."
      )
    );
  }

  static toSettingSchema(
    volumeData: ResultVolumeWithFileDB,
    physicalDimensions: PhysicalDimensions
  ): z.infer<typeof volumeSettings> {
    const rawFilePath = volumeData.dataFile.rawFilePath;
    if (!rawFilePath) {
      throw new ApiError(404, "Result volume is missing its raw file.");
    }
    return {
      file: path.basename(rawFilePath),
      size: {
        x: volumeData.sizeX,
        y: volumeData.sizeY,
        z: volumeData.sizeZ,
      },
      physicalUnit: physicalDimensions.physicalUnit,
      physicalSize: {
        x: physicalDimensions.physicalSizeX,
        y: physicalDimensions.physicalSizeY,
        z: physicalDimensions.physicalSizeZ,
      },
      bytesPerVoxel: volumeData.bytesPerVoxel,
      usedBits: volumeData.usedBits,
      skipBytes: volumeData.skipBytes,
      isLittleEndian: volumeData.isLittleEndian,
      isSigned: volumeData.isSigned,
      addValue: volumeData.addValue,
    };
  }
}
