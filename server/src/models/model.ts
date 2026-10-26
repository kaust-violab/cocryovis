import DatabaseModel from "./database-model";
import prismaManager from "../tools/prisma-manager";
import WriteLockManager from "../tools/write-lock-manager";
import Project from "./project";
import { MissingResourceError } from "../tools/error-handler";
import type { Prisma, Model as PrismaModel } from "@prisma/client";
import type z from "zod";
import type { getModelQuerySchema } from "@cocryovis/schemas/models-path-schema";

export type ModelDB = PrismaModel;
export type Options = z.infer<typeof getModelQuerySchema>;

export default class Model extends DatabaseModel {
  static override modelName = "model";
  static override lockManager = new WriteLockManager(this.modelName);

  static override get db() {
    return prismaManager.db.model;
  }

  static override async getById(
    id: number,
    { checkpoints = false, project = false }: Options = {}
  ) {
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

  static override async getByIds(ids: number[]): Promise<ModelDB[]> {
    return (await super.getByIds(ids)) as ModelDB[];
  }

  static async getModelsFromProject(
    projectId: number,
    { checkpoints = false, project = false }: Options = {}
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

  static override async create(
    name: string,
    description: string,
    creatorId: number,
    projectId: number
  ): Promise<ModelDB> {
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

  static async clone(
    sourceId: number,
    creatorId: number,
    projectId: number
  ): Promise<ModelDB> {
    return await prismaManager.db.$transaction(async (tx) => {
      return this.cloneTransaction(tx, sourceId, creatorId, projectId);
    });
  }

  static async cloneTransaction(
    tx: Prisma.TransactionClient,
    sourceId: number,
    creatorId: number,
    projectId: number | null = null
  ): Promise<ModelDB> {
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
      (newModelData as Record<string, unknown>).projects = {
        connect: { id: projectId },
      };
    }

    const newModel = await tx.model.create({
      data: newModelData as Prisma.ModelUncheckedCreateInput,
    });

    return newModel;
  }

  static override async update(
    id: number,
    changes: Prisma.ModelUpdateInput
  ): Promise<ModelDB> {
    return (await super.update(id, changes)) as ModelDB;
  }

  static override async del(modelId: number): Promise<ModelDB> {
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
