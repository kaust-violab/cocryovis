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
import type { Prisma } from "@prisma/client";
import ResultDataFile from "./result-data-file";
import type z from "zod";
import type { volumeQuerySchema } from "@cocryovis/schemas/volume-path-schema";
import type { SparseVolumeDataWithFileDB } from "./volume-data";

export type {
  Volume as VolumeDB,
  SparseLabelVolumeData as SparseLabelVolumeDataDB,
  PseudoLabelVolumeData as PseudoLabelVolumeDataDB,
} from "@prisma/client";

export default class Volume extends DatabaseModel {
  static override modelName = "volume";
  static override lockManager = new WriteLockManager(this.modelName);
  static annotationsTempDirectory = path.join(
    appConfig.tempPath,
    "annotations"
  );

  static override get db() {
    return prismaManager.db.volume;
  }

  static override async getById(
    id: number,
    options: z.infer<typeof volumeQuerySchema> = {
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

  static async getByIdWithFileDeep(id: number) {
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

  static async getVolumesFromProject(
    projectId: number,
    options: z.infer<typeof volumeQuerySchema> = {
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

  static async getVolumesFromProjectDeep(projectId: number) {
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

  static override async getByIds(ids: number[]): Promise<VolumeDB[]> {
    return (await super.getByIds(ids)) as VolumeDB[];
  }

  static async getMultipleByIdDeep(
    ids: number[],
    {
      rawData = false,
      sparseVolumes = false,
      pseudoVolumes = false,
    }: { rawData?: boolean; sparseVolumes?: boolean; pseudoVolumes?: boolean }
  ) {
    const entry = await this.db.findMany({
      where: { id: { in: ids } },
      include: {
        rawData: rawData,
        sparseVolumes: sparseVolumes,
        pseudoVolumes: pseudoVolumes,
      },
    });
    return entry;
  }

  static async getMultipleByIdWithFileDeep(ids: number[]) {
    return await this.db.findMany({
      where: { id: { in: ids } },
      include: {
        rawData: { include: { dataFile: true } },
        pseudoVolumes: { include: { dataFile: true } },
      },
    });
  }

  static override async create(
    name: string,
    description: string,
    creatorId: number,
    projectId: number
  ): Promise<VolumeDB> {
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

  static override async update(
    id: number,
    changes: Prisma.VolumeUpdateInput
  ): Promise<VolumeDB> {
    return (await super.update(id, changes)) as VolumeDB;
  }

  static override async del(
    volumeId: number,
    client?: Prisma.TransactionClient
  ): Promise<VolumeDB> {
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

  static async addPseudoLabelsFromFolder(
    folderPath: string,
    creatorId: number,
    volumeId: number,
    originalLabels: SparseVolumeDataWithFileDB[],
    client?: Prisma.TransactionClient
  ): Promise<PseudoLabelVolumeDataDB[] | undefined> {
    return await withTransaction(client, async (tx) => {
      const volume = await tx.volume.findUnique({
        where: { id: volumeId },
        include: {
          sparseVolumes: true,
          pseudoVolumes: true,
        },
      });
      if (!volume) {
        throw MissingResourceError.fromId(volumeId, this.modelName);
      }

      if (
        volume.sparseVolumes.length + volume.pseudoVolumes.length >
        appConfig.maxVolumeChannels
      ) {
        throw new ApiError(
          400,
          "Volume does not have enough space to generate pseudo labels from manual label set."
        );
      }

      const newFolders: string[] = [];
      const files = await fsPromises.readdir(folderPath);

      const newPseudoLabels: PseudoLabelVolumeDataDB[] = [];
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
          if (pseudoLabelVolumeData.dataFile.path) {
            newFolders.push(pseudoLabelVolumeData.dataFile.path);
          }
          newPseudoLabels.push(pseudoLabelVolumeData);
        }

        return newPseudoLabels;
      } catch {
        newFolders.forEach((folder) => {
          try {
            void fsPromises.rm(folder, {
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
