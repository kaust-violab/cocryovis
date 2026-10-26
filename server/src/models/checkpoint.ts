import DatabaseModel, { withTransaction } from "./database-model";
import path from "path";
import fsPromises from "node:fs/promises";
import prismaManager from "../tools/prisma-manager";
import appConfig from "../tools/config";
import fileSystem from "fs";
import { unpackFiles } from "../tools/file-handler";
import type fileUpload from "express-fileupload";
import WriteLockManager from "../tools/write-lock-manager";
import { ApiError } from "../tools/error-handler";
import type { Prisma, Checkpoint as PrismaCheckpoint } from "@prisma/client";

export type CheckpointDB = PrismaCheckpoint;

export default class Checkpoint extends DatabaseModel {
  static checkpointFolder = "checkpoints";
  static acceptedFileExtensions = [".ckpt"];
  static override modelName = "checkpoint";
  static override lockManager = new WriteLockManager(this.modelName);

  static override get db() {
    return prismaManager.db.checkpoint;
  }

  static override async getById(id: number): Promise<CheckpointDB> {
    return (await super.getById(id)) as CheckpointDB;
  }

  static async getFromModel(modelId: number): Promise<CheckpointDB[]> {
    const checkpoints = await this.db.findMany({
      where: {
        model: {
          id: modelId,
        },
      },
    });

    return checkpoints;
  }

  static override async getByIds(ids: number[]): Promise<CheckpointDB[]> {
    return (await super.getByIds(ids)) as CheckpointDB[];
  }

  static override async create(
    creatorId: number,
    modelId: number,
    client?: Prisma.TransactionClient
  ): Promise<CheckpointDB> {
    return await withTransaction(client, async (tx) => {
      let checkpoint = await tx[this.modelName as "checkpoint"].create({
        data: {
          creatorId: creatorId,
          // @ts-expect-error -- pre-existing: Checkpoint has no "models" relation; kept to preserve original behaviour
          models: {
            connect: { id: modelId },
          },
        },
      });

      const folderPath = await this.#createFolder(checkpoint);

      try {
        checkpoint = await tx.checkpoint.update({
          where: { id: checkpoint.id },
          data: { folderPath: folderPath },
        });
      } catch (error) {
        await fsPromises.rm(folderPath, {
          recursive: true,
          force: true,
        });
        throw error;
      }
      return checkpoint;
    });
  }

  static async createFromFiles(
    creatorId: number,
    modelId: number,
    files: fileUpload.UploadedFile[],
    client?: Prisma.TransactionClient
  ): Promise<CheckpointDB[]> {
    const unpackedFiles = await unpackFiles(files, this.acceptedFileExtensions);
    if (unpackedFiles.length === 0) {
      throw new Error("No valid checkpoint files found");
    }

    const result: CheckpointDB[] = [];

    for (const unpackedFile of unpackedFiles) {
      result.push(
        await withTransaction(client, async (tx) => {
          let checkpoint: CheckpointDB = await tx.checkpoint.create({
            data: {
              creatorId,
              modelId,
            },
          });

          const folderPath = await this.#createFolder(checkpoint);
          const filePath = await unpackedFile.saveAs(folderPath);

          try {
            checkpoint = await tx.checkpoint.update({
              where: { id: checkpoint.id },
              data: {
                folderPath,
                filePath,
              },
            });
          } catch (error) {
            await fsPromises.rm(folderPath, {
              recursive: true,
              force: true,
            });
            throw error;
          }

          return checkpoint;
        })
      );
    }

    return result;
  }

  static async createFromFolder(
    creatorId: number,
    modelId: number,
    labelIds: number[],
    folderPath: string,
    filePath: string,
    client?: Prisma.TransactionClient
  ) {
    try {
      return await withTransaction(client, async (tx) => {
        let checkpoint: CheckpointDB = await tx.checkpoint.create({
          data: {
            creatorId: creatorId,
            modelId,
            labels: {
              connect: labelIds.map((id) => ({ id })),
            },
          },
        });

        const checkpointPath = await Checkpoint.reserveFolderName(
          checkpoint.id
        );
        await fsPromises.rename(folderPath, checkpointPath);
        const checkpointFilePath = path.join(
          checkpointPath,
          path.basename(filePath)
        );

        try {
          checkpoint = await tx.checkpoint.update({
            where: { id: checkpoint.id },
            data: {
              folderPath: checkpointPath,
              filePath: checkpointFilePath,
            },
          });
        } catch (error) {
          await fsPromises.rm(checkpointPath, {
            recursive: true,
            force: true,
          });
          throw error;
        }
        return checkpoint;
      });
    } catch (error) {
      await fsPromises.rm(folderPath, {
        recursive: true,
        force: true,
      });
      throw error;
    }
  }

  static override async update(
    id: number,
    changes: Prisma.CheckpointUpdateInput
  ): Promise<CheckpointDB> {
    return (await super.update(id, changes)) as CheckpointDB;
  }

  static override async del(checkpointId: number): Promise<CheckpointDB> {
    return await this.withWriteLock(checkpointId, null, () => {
      return this.db.delete({
        where: { id: checkpointId },
      });
    });
    // const fileDeleteStack = [];

    // const checkpoint = await prismaManager.db.$transaction(
    //     async (tx) => {
    //         let checkpoint = await tx.checkpoint.findUnique({
    //             where: { id: checkpointId },
    //             include: {
    //                 models: modelId !== null,
    //                 results: true,
    //                 labels: true,
    //             },
    //         });

    //         if (
    //             modelId &&
    //             !checkpoint.models.some((m) => m.id === modelId)
    //         ) {
    //             throw new ApiError(
    //                 400,
    //                 "Checkpoint is not part of the model."
    //             );
    //         }

    //         if (!modelId && checkpoint.results.length > 0) {
    //             throw new ApiError(
    //                 400,
    //                 "Cannot remove checkpoint as long as its referenced in at least one result."
    //             );
    //         }

    //         if (
    //             modelId &&
    //             (checkpoint.models.length > 1 ||
    //                 checkpoint.results.length > 0)
    //         ) {
    //             await tx.checkpoint.update({
    //                 where: {
    //                     id: checkpointId,
    //                 },
    //                 data: {
    //                     models: {
    //                         disconnect: { id: modelId },
    //                     },
    //                 },
    //             });
    //         } else {
    //             await this.withWriteLock(checkpointId, null, () => {
    //                 return tx.checkpoint.delete({
    //                     where: { id: checkpointId },
    //                 });
    //             });

    //             fileDeleteStack.push(
    //                 ...(await PseudoLabeledVolumeData.deleteZombies(
    //                     checkpoint.labels.map((l) => l.id),
    //                     tx
    //                 ))
    //             );

    //             if (checkpoint.folderPath) {
    //                 await fsPromises.rm(folderPath, {
    //                     recursive: true,
    //                     force: true,
    //                 });
    //             }
    //         }
    //         return checkpoint;
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

    // return checkpoint;
  }

  static async #createFolder(checkpoint: CheckpointDB) {
    const folderPath = path.join(
      appConfig.dataPath,
      this.checkpointFolder,
      checkpoint.id.toString()
    );
    if (fileSystem.existsSync(folderPath)) {
      if (appConfig.safeMode) {
        throw new ApiError(400, `Checkpoint directory already exists`);
      } else {
        await fsPromises.rm(folderPath, {
          recursive: true,
          force: true,
        });
      }
    }
    fileSystem.mkdirSync(folderPath, { recursive: true });
    return folderPath;
  }

  static getFilePaths(checkpoint: CheckpointDB): string[] {
    return checkpoint.folderPath ? [checkpoint.folderPath] : [];
  }

  static async reserveFolderName(id: number): Promise<string> {
    const checkpointFolderPath = path.join(
      appConfig.dataPath,
      this.checkpointFolder
    );
    const folderPath = path.join(checkpointFolderPath, id.toString());
    await fsPromises.mkdir(checkpointFolderPath, { recursive: true });
    if (fileSystem.existsSync(folderPath)) {
      if (appConfig.safeMode) {
        throw new ApiError(400, `Checkpoint directory already exists`);
      } else {
        await fsPromises.rm(folderPath, {
          recursive: true,
          force: true,
        });
      }
    }
    return folderPath;
  }
}
