import DatabaseModel, { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import fsPromises from "node:fs/promises";
import appConfig from "../tools/config";
import path from "path";
import fileSystem from "fs";
import RawVolumeData from "./raw-volume-data";
import WriteLockManager from "../tools/write-lock-manager";
import { ApiError, MissingResourceError } from "../tools/error-handler";
import type fileUpload from "express-fileupload";
import { unpackFiles } from "../tools/file-handler";
import Utils from "../tools/utils";
import type { Prisma, Result as PrismaResult } from "@prisma/client";
import ResultVolume from "./result-volume";
import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import ResultDataFile from "./result-data-file";

export type ResultDB = PrismaResult;
export interface ResultConfig {
  name: string;
  rawFileName: string;
  settingsFileName: string;
  index: number;
  rawVolumeChannel?: boolean;
}

export default class Result extends DatabaseModel {
  static resultsFolder = "results";
  static acceptedFileExtensions = [".log", ".raw", ".json"];
  static override modelName = "result";
  static override lockManager = new WriteLockManager(this.modelName);

  static override get db() {
    return prismaManager.db.result;
  }

  static override async getById(id: number): Promise<ResultDB> {
    return (await super.getById(id)) as ResultDB;
  }

  static async getFromVolume(
    volumeId: number,
    {
      checkpoint = false,
      volume = false,
      resultVolumes = false,
    }: { checkpoint?: boolean; volume?: boolean; resultVolumes?: boolean }
  ) {
    const results = await this.db.findMany({
      where: {
        volumeId,
      },
      include: {
        checkpoint: checkpoint,
        volume: volume,
        resultVolumes: resultVolumes,
      },
    });

    return results;
  }

  static async getByIdDeep(
    id: number,
    {
      checkpoint = false,
      volume = false,
      resultVolumes = false,
    }: { checkpoint?: boolean; volume?: boolean; resultVolumes?: boolean }
  ) {
    const result = await this.db.findUnique({
      where: {
        id: id,
      },
      include: {
        checkpoint: checkpoint,
        volume: volume,
        resultVolumes: resultVolumes,
      },
    });
    if (result === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return result;
  }

  static override async create(
    creatorId: number,
    checkpointId: number,
    volumeId: number
  ) {
    return await this.db.create({
      data: {
        creatorId: creatorId,
        checkpointId: checkpointId,
        volumeId: volumeId,
      },
    });
  }

  static async createFromFolder(
    creatorId: number,
    checkpointId: number,
    volumeId: number,
    config: ResultConfig[],
    folderPath: string,
    logFile: string | null = null,
    client?: Prisma.TransactionClient
  ) {
    try {
      return await withTransaction(client, async (tx) => {
        let result: ResultDB = await tx.result.create({
          data: {
            creatorId: creatorId,
            checkpointId: checkpointId,
            volumeId: volumeId,
          },
        });

        let rawVolumeChannel: number | null = null;

        for (const fileDescriptor of config) {
          const rawFilePath = path.join(folderPath, fileDescriptor.rawFileName);
          const settingsFilePath = path.join(
            folderPath,
            fileDescriptor.settingsFileName
          );
          if (
            !fileSystem.existsSync(rawFilePath) ||
            !fileSystem.existsSync(settingsFilePath)
          ) {
            throw new ApiError(
              500,
              "Failed result creation: One of the volume files is missing."
            );
          }
          const settingFile = await fsPromises.readFile(settingsFilePath);
          const settings = volumeSettings.parse(
            JSON.parse(settingFile.toString("utf8"))
          );

          await ResultVolume.create(
            result.id,
            rawFilePath,
            {
              name: fileDescriptor.name,
              index: fileDescriptor.index,
              sizeX: settings.size.x,
              sizeY: settings.size.y,
              sizeZ: settings.size.z,
              skipBytes: settings.skipBytes,
              isLittleEndian: settings.isLittleEndian,
              isSigned: settings.isSigned,
              addValue: settings.addValue,
              bytesPerVoxel: settings.bytesPerVoxel,
              usedBits: settings.usedBits,
            },
            tx
          );

          if (fileDescriptor.rawVolumeChannel) {
            if (rawVolumeChannel !== null) {
              throw new ApiError(
                500,
                "Failed result creation: Two volumes marked as raw volume channel."
              );
            }
            rawVolumeChannel = fileDescriptor.index;
          }
        }

        result = await tx.result.update({
          where: { id: result.id },
          data: {
            rawVolumeChannel: rawVolumeChannel,
            logFile: logFile,
          },
        });

        return result;
      });
    } catch (error) {
      try {
        await fsPromises.rm(folderPath, {
          recursive: true,
          force: true,
        });
      } catch (fsError) {
        console.error(
          `Error cleaning up result creation folder: ${(fsError as Error).message}`
        );
      }
      throw error;
    } finally {
      try {
        await fsPromises.rm(folderPath, {
          recursive: true,
          force: true,
        });
      } catch (fsError) {
        console.error(
          `Error cleaning up result creation folder: ${(fsError as Error).message}`
        );
      }
    }
  }

  static async createFromFiles(
    creatorId: number,
    checkpointId: number,
    volumeId: number,
    volumeDescriptors: {
      name: string;
      index: number;
      rawVolumeChannel?: boolean;
    }[],
    files: fileUpload.UploadedFile[],
    client?: Prisma.TransactionClient
  ) {
    const volumeData = await RawVolumeData.getFromVolumeIdWithData(volumeId);

    if (!volumeData?.dataFile.rawFilePath) {
      throw new ApiError(400, "Source Volume Data is missing a raw file.");
    }

    const pendingFiles = await unpackFiles(files);

    const resultsFolderPath = path.join(appConfig.dataPath, this.resultsFolder);

    void fsPromises.mkdir(resultsFolderPath, {
      recursive: true,
    });

    const resultPath: string | null = null;
    let meanFilteredTmpFolder: string | null = null;
    let meanFilteredFilePath: string | null = null;

    if (
      !volumeDescriptors.some((volume) => volume?.rawVolumeChannel === true)
    ) {
      await fsPromises.mkdir(path.join(appConfig.tempPath, "mean-filter"), {
        recursive: true,
      });
      meanFilteredTmpFolder = await fsPromises.mkdtemp(
        path.join(appConfig.tempPath, "mean-filter") + "/"
      );
      const meanFilteredFileName =
        path.parse(volumeData.dataFile.rawFilePath).name +
        "_mean3_inverted.raw";
      meanFilteredFilePath = path.join(
        meanFilteredTmpFolder,
        meanFilteredFileName
      );
      await Utils.meanFilter(
        volumeData.dataFile.rawFilePath,
        volumeData.sizeX,
        volumeData.sizeY,
        volumeData.sizeZ,
        meanFilteredFilePath
      );
    }

    try {
      return await withTransaction(client, async (tx) => {
        let result: ResultDB = await tx.result.create({
          data: {
            creatorId: creatorId,
            checkpointId: checkpointId,
            volumeId: volumeId,
          },
        });

        let rawVolumeChannel: number | null = null;

        for (const [i, pendingFile] of pendingFiles.entries()) {
          await ResultVolume.create(
            result.id,
            pendingFile,
            {
              name: volumeDescriptors[i].name,
              index: volumeDescriptors[i].index,
              sizeX: volumeData.sizeX,
              sizeY: volumeData.sizeY,
              sizeZ: volumeData.sizeZ,
              skipBytes: volumeData.skipBytes,
              isLittleEndian: volumeData.isLittleEndian,
              isSigned: volumeData.isSigned,
              addValue: volumeData.addValue,
              bytesPerVoxel: volumeData.bytesPerVoxel,
              usedBits: volumeData.usedBits,
            },
            tx
          );

          if (volumeDescriptors[i].rawVolumeChannel) {
            if (rawVolumeChannel !== null) {
              throw new ApiError(
                500,
                "Failed result creation: Two volumes marked as raw volume channel."
              );
            }
            rawVolumeChannel = volumeDescriptors[i].index;
          }
        }

        if (meanFilteredFilePath !== null) {
          const usedIndices = volumeDescriptors
            .map((descriptor) => descriptor.index)
            .sort((a, b) => a - b);

          let index = 0;
          for (const usedIndex of usedIndices) {
            if (usedIndex !== index) {
              break;
            }
            index++;
          }

          rawVolumeChannel = index;

          await ResultVolume.create(
            result.id,
            meanFilteredFilePath,
            {
              name: "Mean3-Inverted",
              index: index,
              sizeX: volumeData.sizeX,
              sizeY: volumeData.sizeY,
              sizeZ: volumeData.sizeZ,
              skipBytes: volumeData.skipBytes,
              isLittleEndian: volumeData.isLittleEndian,
              isSigned: volumeData.isSigned,
              addValue: volumeData.addValue,
              bytesPerVoxel: volumeData.bytesPerVoxel,
              usedBits: volumeData.usedBits,
            },
            tx
          );
        }

        result = await tx.result.update({
          where: { id: result.id },
          data: {
            rawVolumeChannel: rawVolumeChannel,
          },
        });

        return result;
      });
    } catch (error) {
      if (resultPath !== null) {
        await fsPromises.rm(resultPath, {
          recursive: true,
          force: true,
        });
      }
      if (meanFilteredFilePath !== null) {
        await fsPromises.rm(meanFilteredFilePath, {
          recursive: true,
          force: true,
        });
      }
      throw error;
    } finally {
      if (meanFilteredTmpFolder !== null) {
        await fsPromises.rm(meanFilteredTmpFolder, {
          recursive: true,
          force: true,
        });
      }
    }
  }

  static override async update(
    id: number,
    changes: Prisma.ResultUpdateInput
  ): Promise<ResultDB> {
    return (await super.update(id, changes)) as ResultDB;
  }

  static override async del(
    resultId: number,
    client?: Prisma.TransactionClient
  ): Promise<ResultDB> {
    return await withTransaction(client, async (tx) => {
      const result = await tx.result.delete({
        where: { id: resultId },
      });

      await ResultDataFile.deleteZombies(tx);

      return result;
    });
  }

  static async reserveFolderName(id: number, create = false): Promise<string> {
    const resultsFolderPath = path.join(appConfig.dataPath, this.resultsFolder);
    const folderPath = path.join(resultsFolderPath, id.toString());
    await fsPromises.mkdir(resultsFolderPath, { recursive: true });
    if (fileSystem.existsSync(folderPath)) {
      if (appConfig.safeMode) {
        throw new ApiError(500, `Result directory already exists`);
      } else {
        await fsPromises.rm(folderPath, {
          recursive: true,
          force: true,
        });
      }
    }

    if (create) {
      await fsPromises.mkdir(folderPath, { recursive: true });
    }

    return folderPath;
  }
}
