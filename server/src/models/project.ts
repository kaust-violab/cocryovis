import DatabaseModel, { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import fsPromises from "fs/promises";
import { ApiError, MissingResourceError } from "../tools/error-handler";
import RawVolumeDataFile from "./raw-volume-data-file";
import SparseVolumeDataFile from "./sparse-volume-data-file";
import PseudoVolumeDataFile from "./pseudo-volume-data-file";
import type {
  Prisma,
  Project as PrismaProject,
  ProjectAccess as PrismaProjectAccess,
} from "@prisma/client";
import ResultDataFile from "./result-data-file";
import type z from "zod";
import type { volumeQuerySchema } from "@cocryovis/schemas/volume-path-schema";

export type ProjectDB = PrismaProject;
export type ProjectAccess = PrismaProjectAccess;
export interface Options {
  volumes?: boolean | { include: z.infer<typeof volumeQuerySchema> };
  models?: boolean | { include: { checkpoints: boolean } };
  owner?: boolean;
}
export interface UserAccessInfo {
  userId: number;
  accessLevel: number;
}

export default class Project extends DatabaseModel {
  static override modelName = "project";

  static override get db() {
    return prismaManager.db.project;
  }

  static async getByIdDeep(projectId: number, userId = -1) {
    const project = await this.db.findUnique({
      where: {
        id: projectId,
      },
      include: {
        volumes: {
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
        },
        models: {
          include: {
            checkpoints: true,
          },
        },
        projectAccess: {
          where: {
            userId: userId,
          },
        },
      },
    });

    if (!project) {
      throw ApiError.fromId(projectId, this.modelName);
    }

    const projectWithAccessLevel = { ...project, accessLevel: -1 };

    if (project.ownerId === userId) {
      projectWithAccessLevel.accessLevel = 2;
    } else if (project.projectAccess.length > 0) {
      projectWithAccessLevel.accessLevel = project.projectAccess[0].accessLevel;
    }

    return projectWithAccessLevel;
  }

  static async getUserProjects(
    userId: number,
    { volumes = false, models = false, owner = false }: Options = {}
  ) {
    const projects = await this.db.findMany({
      where: {
        OR: [
          {
            ownerId: userId,
          },
          {
            projectAccess: {
              some: {
                userId: userId,
              },
            },
          },
        ],
      },
      include: {
        volumes: volumes,
        models: models,
        owner: owner,
        projectAccess: {
          where: {
            userId: userId,
          },
        },
      },
    });

    return projects.map(({ projectAccess, ...project }) => {
      const updatedProject = { ...project, accessLevel: -1 };

      if (project.ownerId === userId) {
        updatedProject.accessLevel = 2;
      } else if (projectAccess.length > 0) {
        updatedProject.accessLevel = projectAccess[0].accessLevel;
      }

      return updatedProject;
    });
  }

  static async getUserProjectsDeep(userId: number) {
    const projects = await this.db.findMany({
      where: {
        OR: [
          {
            ownerId: userId,
          },
          {
            projectAccess: {
              some: {
                userId: userId,
              },
            },
          },
        ],
      },
      include: {
        volumes: {
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
        },
        models: {
          include: {
            checkpoints: true,
          },
        },
        projectAccess: {
          where: {
            userId: userId,
          },
        },
      },
    });

    return projects.map(({ projectAccess, ...project }) => {
      const updatedProject = { ...project, accessLevel: -1 };

      if (project.ownerId === userId) {
        updatedProject.accessLevel = 2;
      } else if (projectAccess.length > 0) {
        updatedProject.accessLevel = projectAccess[0].accessLevel;
      }

      return updatedProject;
    });
  }

  static async getUserAccessInfo(
    projectId: number,
    userId: number
  ): Promise<number> {
    const projectAccess = await prismaManager.db.projectAccess.findUnique({
      where: {
        userId_projectId: {
          userId: userId,
          projectId: projectId,
        },
      },
    });
    return projectAccess?.accessLevel ?? -1;
  }

  static async getAccessInfo(id: number): Promise<{
    projectAccess: { ownerId: number; publicAccess: number } | null;
    userAccess: UserAccessInfo[];
  }> {
    const userAccess = await this.getProjectUsersAccessInfo(id);
    const projectAccess = await prismaManager.db.project.findUnique({
      where: { id: id },
      select: {
        ownerId: true,
        publicAccess: true,
      },
    });
    return { projectAccess: projectAccess, userAccess: userAccess };
  }

  static async getProjectUsersAccessInfo(
    id: number
  ): Promise<UserAccessInfo[]> {
    const userAccess = await prismaManager.db.projectAccess.findMany({
      where: {
        projectId: id,
      },
      select: {
        userId: true,
        accessLevel: true,
      },
    });
    return userAccess;
  }

  static async setAccess(
    id: number,
    accessInfo: { publicAccess: number; userAccess: UserAccessInfo[] },
    client?: Prisma.TransactionClient
  ): Promise<{ publicAccess: number; userAccess: UserAccessInfo[] }> {
    return await withTransaction(client, async (tx) => {
      let project = await tx.project.findUnique({
        where: { id: id },
      });

      if (!project) {
        throw ApiError.fromId(id, this.modelName);
      }

      const ownerId = project.ownerId;
      accessInfo.userAccess = accessInfo.userAccess.filter(
        (info) => info.userId !== ownerId
      );

      if (
        accessInfo.publicAccess !== undefined &&
        accessInfo.publicAccess !== project.publicAccess
      ) {
        project = await tx.project.update({
          where: { id: id },
          data: {
            publicAccess: accessInfo.publicAccess,
          },
        });
      }

      for (const accessInstance of accessInfo.userAccess) {
        if (accessInstance.accessLevel < 0) {
          await tx.projectAccess.delete({
            where: {
              userId_projectId: {
                userId: accessInstance.userId,
                projectId: project.id,
              },
            },
            select: {
              userId: true,
              accessLevel: true,
            },
          });
        } else {
          await tx.projectAccess.upsert({
            where: {
              userId_projectId: {
                userId: accessInstance.userId,
                projectId: project.id,
              },
            },
            update: {
              accessLevel: accessInstance.accessLevel,
            },
            create: {
              projectId: project.id,
              userId: accessInstance.userId,
              accessLevel: accessInstance.accessLevel,
            },
            select: {
              userId: true,
              accessLevel: true,
            },
          });
        }
      }

      const userAccess = await tx.projectAccess.findMany({
        where: {
          projectId: id,
        },
        select: {
          userId: true,
          accessLevel: true,
        },
      });

      return {
        publicAccess: project.publicAccess,
        userAccess: userAccess,
      };
    });
  }

  static override async getById(
    id: number,
    { volumes = false, models = false, owner = false }: Options = {}
  ) {
    const entry = await this.db.findUnique({
      where: { id: id },
      include: {
        volumes: volumes,
        models: models,
        owner: owner,
      },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  static override async create(
    name: string,
    description: string,
    ownerId: number
  ): Promise<ProjectDB> {
    return await prismaManager.db.project.create({
      data: { name: name, description: description, ownerId: ownerId },
    });
  }

  /**
   * @param {number} sourceId
   * @param {number} ownerId
   * @returns {Promise<ProjectDB>}
   */
  // static async deepClone(sourceId, ownerId) {
  //     return await prismaManager.db.$transaction(async (tx) => {
  //         const sourceProject = await tx.project.findUnique({
  //             where: { id: sourceId },
  //             include: {
  //                 volumes: {
  //                     select: {
  //                         id: true,
  //                     },
  //                 },
  //                 models: {
  //                     select: {
  //                         id: true,
  //                     },
  //                 },
  //             },
  //         });

  //         if (!sourceProject) {
  //             throw MissingResourceError.fromId(sourceId, this.modelName);
  //         }

  //         const volumes = await Promise.all(
  //             sourceProject.volumes.map(async (v) =>
  //                 Volume.cloneTransaction(tx, v.id, ownerId)
  //             )
  //         );
  //         const models = await Promise.all(
  //             sourceProject.models.map(async (v) =>
  //                 Model.cloneTransaction(tx, v.id, ownerId)
  //             )
  //         );

  //         const newProject = await tx.project.create({
  //             data: {
  //                 name: sourceProject.name,
  //                 description: sourceProject.description,
  //                 ownerId: ownerId,
  //                 volumes: {
  //                     connect: volumes,
  //                 },
  //                 models: {
  //                     connect: models,
  //                 },
  //             },
  //         });

  //         return newProject;
  //     });
  // }

  static override async update(
    id: number,
    changes: Prisma.ProjectUpdateInput
  ): Promise<ProjectDB> {
    return (await super.update(id, changes)) as ProjectDB;
  }

  static override async del(
    id: number,
    client?: Prisma.TransactionClient
  ): Promise<ProjectDB> {
    const fileDeleteStack: string[] = [];

    const project = await withTransaction(client, async (tx) => {
      const project = await this.withWriteLock(id, null, () => {
        return tx.project.delete({
          where: {
            id: id,
          },
          include: {
            volumes: {
              where: {
                project: {
                  id: id,
                },
              },
              include: {
                rawData: true,
                sparseVolumes: true,
                pseudoVolumes: true,
                results: true,
              },
            },
            models: {
              where: {
                project: {
                  id: id,
                },
              },
              include: {
                checkpoints: true,
              },
            },
          },
        });
      });

      await RawVolumeDataFile.deleteZombies(tx);
      await SparseVolumeDataFile.deleteZombies(tx);
      await PseudoVolumeDataFile.deleteZombies(tx);
      await ResultDataFile.deleteZombies(tx);

      return project;
    });

    for (const file of fileDeleteStack) {
      fsPromises
        .rm(file, { recursive: true, force: true })
        .catch((error: unknown) => {
          console.error(`Failed to delete ${file}: ${String(error)}`);
        });
    }

    return project;
  }
}
