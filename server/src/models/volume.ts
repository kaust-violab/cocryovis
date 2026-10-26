// @ts-check

import DatabaseModel, { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import PseudoLabeledVolumeData from "./pseudo-labeled-volume-data";
import fsPromises from "fs/promises";
import appConfig from "../tools/config";
import path from "path";
import WriteLockManager from "../tools/write-lock-manager";
import Project from "./project";
import { ApiError, MissingResourceError } from "../tools/error-handler";
import RawVolumeDataFile from "./raw-volume-data-file";
import SparseVolumeDataFile from "./sparse-volume-data-file";
import PseudoVolumeDataFile from "./pseudo-volume-data-file";
import { Prisma } from "@prisma/client";
import ResultDataFile from "./result-data-file";

/**
 * @import z from "zod"
 * @import { volumeQuerySchema } from "@cocryovis/schemas/volume-path-schema"
 * @typedef { import("@prisma/client").Volume } VolumeDB
 * @typedef { import("@prisma/client").SparseLabelVolumeData } SparseLabelVolumeDataDB
 * @typedef { import("@prisma/client").PseudoLabelVolumeData } PseudoLabelVolumeDataDB
 */

export default class Volume extends DatabaseModel {
  static modelName = "volume";
  static lockManager = new WriteLockManager(this.modelName);
  static annotationsTempDirectory = path.join(
    appConfig.tempPath,
    "annotations"
  );

  static get db() {
    return prismaManager.db.volume;
  }

  /**
   * @param {number} id
   * @param {z.infer<volumeQuerySchema>} options
   */
  static async getById(
    id,
    options = {
      rawData: false,
      sparseVolumes: false,
      pseudoVolumes: false,
      results: false,
      project: false,
    }
  ) {
    const entry = await this.db.findUnique({
      where: { id: id },
      include: {
        rawData: options.rawData,
        sparseVolumes: options.sparseVolumes,
        pseudoVolumes: options.pseudoVolumes,
        results: options.results,
        project: options.project,
      },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  /**
   * @param {number} id
   */
  static async getByIdWithFileDeep(id) {
    const entry = await this.db.findUnique({
      where: { id: id },
      include: {
        rawData: { include: { dataFile: true } },
        sparseVolumes: { include: { dataFile: true } },
        pseudoVolumes: { include: { dataFile: true } },
      },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  /**
   * @param {number} projectId
   * @param {z.infer<volumeQuerySchema>} options
   */
  static async getVolumesFromProject(
    projectId,
    options = {
      rawData: false,
      sparseVolumes: false,
      pseudoVolumes: false,
      results: false,
      project: false,
    }
  ) {
    return await this.db.findMany({
      where: {
        project: {
          id: projectId,
        },
      },
      include: {
        rawData: options.rawData,
        sparseVolumes: options.sparseVolumes,
        pseudoVolumes: options.pseudoVolumes,
        results: options.results,
        project: options.project,
      },
    });
  }

  /**
   * @param {number} projectId
   */
  static async getVolumesFromProjectDeep(projectId) {
    return await this.db.findMany({
      where: {
        project: {
          id: projectId,
        },
      },
      include: {
        rawData: true,
        sparseVolumes: true,
        pseudoVolumes: true,
        results: {
          include: {
            checkpoint: true,
          },
        },
      },
    });
  }

  /**
   * @param {number[]} ids
   * @returns {Promise<VolumeDB[]>}
   */
  static async getByIds(ids) {
    return await super.getByIds(ids);
  }

  /**
   * @param {number[]} ids
   * @param {object} options
   * @param {boolean} [options.rawData]
   * @param {boolean} [options.sparseVolumes]
   * @param {boolean} [options.pseudoVolumes]
   */
  static async getMultipleByIdDeep(
    ids,
    { rawData = false, sparseVolumes = false, pseudoVolumes = false }
  ) {
    let entry = await this.db.findMany({
      where: { id: { in: ids } },
      include: {
        rawData: rawData,
        sparseVolumes: sparseVolumes,
        pseudoVolumes: pseudoVolumes,
      },
    });
    return entry;
  }

  /**
   * @param {number[]} ids
   */
  static async getMultipleByIdWithFileDeep(ids) {
    return await this.db.findMany({
      where: { id: { in: ids } },
      include: {
        rawData: { include: { dataFile: true } },
        pseudoVolumes: { include: { dataFile: true } },
      },
    });
  }

  /**
   * @param {string} name
   * @param {string} description
   * @param {number} creatorId
   * @param {number} projectId
   * @returns {Promise<VolumeDB>}
   */
  static async create(name, description, creatorId, projectId) {
    return Project.withWriteLock(projectId, [this.modelName], () => {
      return this.db.create({
        data: {
          name: name,
          description: description,
          creatorId: creatorId,
          projectId,
        },
      });
    });
  }

  /**
   * @param {number} id
   * @param {import("@prisma/client").Prisma.VolumeUpdateInput} changes
   * @returns {Promise<VolumeDB>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {number} volumeId
   * @param {Prisma.TransactionClient | undefined} [client]
   * @returns { Promise<VolumeDB> }
   */
  static async del(volumeId, client) {
    return await this.withWriteLock(volumeId, null, () => {
      return withTransaction(client, async (tx) => {
        const deletedVolume = await tx.volume.delete({
          where: { id: volumeId },
        });
        await RawVolumeDataFile.deleteZombies(tx);
        await SparseVolumeDataFile.deleteZombies(tx);
        await PseudoVolumeDataFile.deleteZombies(tx);
        await ResultDataFile.deleteZombies(tx);
        return deletedVolume;
      });
    });
  }

  /**
   * @param {string} folderPath
   * @param {number} creatorId
   * @param {number} volumeId
   * @param {import("./volume-data").SparseVolumeDataWithFileDB[] } originalLabels
   * @param {Prisma.TransactionClient | undefined} [client]
   * @returns {Promise<PseudoLabelVolumeDataDB[]>}
   */
  static async addPseudoLabelsFromFolder(
    folderPath,
    creatorId,
    volumeId,
    originalLabels,
    client
  ) {
    return await withTransaction(client, async (tx) => {
      const volume = await tx.volume.findUnique({
        where: { id: volumeId },
        include: {
          sparseVolumes: true,
          pseudoVolumes: true,
        },
      });

      if (
        volume.sparseVolumes.length + volume.pseudoVolumes.length >
        appConfig.maxVolumeChannels
      ) {
        throw new ApiError(
          400,
          "Volume does not have enough space to generate pseudo labels from manual label set."
        );
      }

      const newFolders = [];
      const files = await fsPromises.readdir(folderPath);

      const newPseudoLabels = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const filePath = path.join(folderPath, files[i]);
          const pseudoLabelVolumeData =
            await PseudoLabeledVolumeData.fromRawFile(
              filePath,
              creatorId,
              volumeId,
              originalLabels[i].id,
              originalLabels[i],
              tx
            );
          newFolders.push(pseudoLabelVolumeData.dataFile.path);
          newPseudoLabels.push(pseudoLabelVolumeData);
        }

        return newPseudoLabels;
      } catch {
        newFolders.forEach((folder) => {
          try {
            fsPromises.rm(folder, {
              recursive: true,
              force: true,
            });
          } catch (error) {
            console.log(error);
          }
        });
      }
    });
  }
}
