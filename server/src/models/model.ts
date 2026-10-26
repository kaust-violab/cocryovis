// @ts-check

import DatabaseModel from "./database-model";
import prismaManager from "../tools/prisma-manager";
import WriteLockManager from "../tools/write-lock-manager";
import Project from "./project";
import { MissingResourceError } from "../tools/error-handler";

/**
 * @typedef { import("@prisma/client").Model } ModelDB
 * @import z from "zod"
 * @import { getModelQuerySchema } from "@cocryovis/schemas/models-path-schema";
 * @typedef {z.infer<typeof getModelQuerySchema>} Options
 */

export default class Model extends DatabaseModel {
  static modelName = "model";
  static lockManager = new WriteLockManager(this.modelName);

  static get db() {
    return prismaManager.db.model;
  }

  /**
   * @param {number} id
   * @param {Options} options
   */
  static async getById(id, { checkpoints = false, project = false } = {}) {
    const entry = await this.db.findUniqueOrThrow({
      where: { id: id },
      include: {
        checkpoints: checkpoints,
        project: project,
      },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  /**
   * @param {number[]} ids
   * @returns {Promise<ModelDB[]>}
   */
  static async getByIds(ids) {
    return await super.getByIds(ids);
  }

  /**
   * @param {number} projectId
   * @param {Options} options
   */
  static async getModelsFromProject(
    projectId,
    { checkpoints = false, project = false } = {}
  ) {
    return await this.db.findMany({
      where: {
        project: {
          id: projectId,
        },
      },
      include: {
        checkpoints: checkpoints,
        project: project,
      },
    });
  }

  /**
   * @param {string} name
   * @param {string} description
   * @param {number} creatorId
   * @param {number} projectId
   * @returns {Promise<ModelDB>}
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
   * @param {number} sourceId
   * @param {number} creatorId
   * @param {number} projectId
   * @returns {Promise<ModelDB>}
   */
  static async clone(sourceId, creatorId, projectId) {
    return await prismaManager.db.$transaction(async (tx) => {
      return this.cloneTransaction(tx, sourceId, creatorId, projectId);
    });
  }

  /**
   * @param {import("@prisma/client").Prisma.TransactionClient} tx
   * @param {number} sourceId
   * @param {number} creatorId
   * @param {number?} projectId
   * @returns {Promise<ModelDB>}
   */
  static async cloneTransaction(tx, sourceId, creatorId, projectId = null) {
    const sourceModel = await tx.model.findUnique({
      where: { id: sourceId },
      include: {
        checkpoints: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!sourceModel) {
      throw MissingResourceError.fromId(sourceId, this.modelName);
    }

    const newModelData = {
      name: sourceModel.name,
      description: sourceModel.description,
      creatorId: creatorId,
      projectId,
    };

    if (projectId != null) {
      newModelData.projects = {
        connect: { id: projectId },
      };
    }

    const newModel = await tx.model.create({
      data: newModelData,
    });

    return newModel;
  }

  /**
   * @param {number} id
   * @param {import("@prisma/client").Prisma.ModelUpdateInput} changes
   * @returns {Promise<ModelDB>}
   */
  static async update(id, changes) {
    return await super.update(id, changes);
  }

  /**
   * @param {number} modelId
   * @returns { Promise<ModelDB> }
   */
  static async del(modelId) {
    return await this.withWriteLock(modelId, null, async () => {
      return this.db.delete({
        where: { id: modelId },
      });
    });

    // const fileDeleteStack = [];

    // const model = await prismaManager.db.$transaction(
    //     async (tx) => {
    //         let model = await tx.model.findUnique({
    //             where: { id: modelId },
    //             include: {
    //                 project: projectId !== null,
    //                 checkpoints: {
    //                     include: {
    //                         labels: true,
    //                     },
    //                 },
    //             },
    //         });

    //         if (
    //             projectId &&
    //             !model.projects.some((m) => m.id === projectId)
    //         ) {
    //             throw new ApiError(
    //                 400,
    //                 "Model is not part of the project."
    //             );
    //         }

    //         if (projectId && model.projects.length > 1) {
    //             await tx.model.update({
    //                 where: {
    //                     id: modelId,
    //                 },
    //                 data: {
    //                     projects: {
    //                         disconnect: { id: projectId },
    //                     },
    //                 },
    //             });
    //         } else {
    //             await this.withWriteLock(modelId, null, async () => {
    //                 return tx.model.delete({
    //                     where: { id: modelId },
    //                 });
    //             });

    //             fileDeleteStack.push(
    //                 ...(await Checkpoint.deleteZombies(
    //                     model.checkpoints.map((m) => m.id),
    //                     tx
    //                 ))
    //             );

    //             const allPseudoVolumes = [];
    //             model.checkpoints.forEach((v) =>
    //                 allPseudoVolumes.push(...v.labels)
    //             );
    //             fileDeleteStack.push(
    //                 ...(await PseudoLabeledVolumeData.deleteZombies(
    //                     allPseudoVolumes,
    //                     tx
    //                 ))
    //             );

    //             return model;
    //         }

    //         return model;
    //     },
    //     {
    //         timeout: 60000,
    //     }
    // );

    // for (const file of fileDeleteStack) {
    //     fsPromises
    //         .rm(file, { recursive: true, force: true })
    //         .catch((error) => {
    //             console.error(`Failed to delete ${file}: ${error}`);
    //         });
    // }

    // return model;
  }
}
