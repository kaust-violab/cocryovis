// @ts-check

import DatabaseModel from "./database-model";
import prismaManager from "../tools/prisma-manager";
import path from "path";
import fs from "fs";
import { ApiError } from "../tools/error-handler";
import { PendingUpload } from "../tools/file-handler";
import ResultDataFile from "./result-data-file";

/**
 * @typedef { import("@prisma/client").ResultVolume } ResultVolumeDB
 * @typedef { ResultVolumeDB & { dataFile: import("@prisma/client").ResultDataFile } } ResultVolumeWithFileDB
 * @import z from "zod"
 * @import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema"
 */

export default class ResultVolume extends DatabaseModel {
  static modelName = "resultVolume";

  static get db() {
    return prismaManager.db.resultVolume;
  }

  /**
   * @param {number} id
   * @returns {Promise<ResultVolumeDB>}
   */
  static async getById(id) {
    return await super.getById(id);
  }

  /**
   * @param {number} resultId
   * @param {string | PendingUpload} file
   * @param {Omit<import("@prisma/client").Prisma.ResultVolumeCreateInput, "result" | "dataFile">} volumeParameters
   * @param {import("@prisma/client").Prisma.TransactionClient} client
   * @returns {Promise<ResultVolumeDB>}
   */
  static async create(
    resultId,
    file,
    volumeParameters,
    client = prismaManager.db
  ) {
    let volume;
    let newDirectory;
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
      let newFilePath;
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
          `Error rolling back result volume creation: ${deleteError.message}`
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
            `Error rolling back result volume directory creation: ${fsError.message}`
          );
        }
      }
      throw new ApiError(500, `Error creating result volume: ${error.message}`);
    }
  }

  /**
   * @param {number} _id
   * @returns {Promise<ResultVolumeDB>}
   */
  static async del(_id) {
    throw new Error(
      "Result Volume cannot be deleted manually. Delete Result instead."
    );
  }

  /**
   * @param {ResultVolumeWithFileDB} volumeData
   * @param { PhysicalDimensions } physicalDimensions
   * @returns {z.infer<typeof volumeSettings>}
   */
  static toSettingSchema(volumeData, physicalDimensions) {
    return {
      file: path.basename(volumeData.dataFile.rawFilePath),
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
