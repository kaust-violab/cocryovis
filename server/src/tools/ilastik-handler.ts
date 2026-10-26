import fileSystem from "fs";
import path from "path";
import fsPromises from "node:fs/promises";
import Utils from "./utils";
import TaskQueue, {
  Deferred,
  type QueuedTaskHistory,
  Task,
} from "./task-queue";
import Volume from "../models/volume";
import appConfig from "./config";
import type LogFile from "./log-manager";
import RawVolumeData from "../models/raw-volume-data";
import SparseLabeledVolumeData from "../models/sparse-labeled-volume-data";
import PseudoLabeledVolumeData from "../models/pseudo-labeled-volume-data";
import type { PseudoLabelVolumeDataDB } from "../models/volume";
import { WriteMultiLock } from "./write-lock-manager";
import { ApiError } from "./error-handler";
import WebSocketManager, { ActionTypes } from "./websocket-manager";
import TaskHistory from "../models/task-history";
import type z from "zod";
import type { volumeSizeSchema } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import moduleConfigLoader from "./module-config-loader";
import { ilastikConfigSchema, IlastikModule } from "../modules/ilastik-module";

type VolumeWithFileDeep = Awaited<
  ReturnType<typeof Volume.getByIdWithFileDeep>
>;

/** A volume that passed IlastikHandler.checkVolumeProperties. */
type CheckedVolume = Omit<VolumeWithFileDeep, "rawData" | "sparseVolumes"> & {
  rawData: RawVolumeDataWithFileDB & {
    dataFile: { rawFilePath: string };
  };
  sparseVolumes: (SparseVolumeDataWithFileDB & {
    dataFile: { rawFilePath: string };
  })[];
};

class LabelGenerationTask extends Task<PseudoLabelVolumeDataDB[] | undefined> {
  private ilastikHandler: IlastikHandler;
  private volumeId: number;
  private outputPath: string;
  protected logName = "label-generation";

  constructor(
    userId: number,
    ilastikHandler: IlastikHandler,
    volumeId: number,
    outputPath: string
  ) {
    super(userId);
    this.ilastikHandler = ilastikHandler;
    this.volumeId = volumeId;
    this.outputPath = outputPath;
  }

  override taskHistoryData() {
    return {
      taskType: TaskHistory.type.LabelInference,
      volumeId: this.volumeId,
    };
  }

  override async execute(): Promise<PseudoLabelVolumeDataDB[] | undefined> {
    return await this.ilastikHandler.generateLabels(
      this.volumeId,
      this.userId,
      this.outputPath,
      this.logFile
    );
  }
}

export default class IlastikHandler {
  static readonly rawDataset = "/raw_data";
  static readonly labelsDataset = "/labels";
  static readonly pseudoLabelsDataset = "/pseudo_labels";

  private config: AppConfig;
  private ilastikTempDirectory: string;
  private taskQueue: TaskQueue;
  private ilastikModule: IlastikModule;

  constructor(config: AppConfig) {
    this.config = config;
    this.taskQueue = new TaskQueue();
    this.ilastikTempDirectory = path.join(this.config.tempPath, "ilastik");
    const ilastikConfig = ilastikConfigSchema.parse(
      moduleConfigLoader.getModuleConfig("Ilastik")
    );
    this.ilastikModule = new IlastikModule(ilastikConfig);
  }

  async queueLabelGeneration(
    volumeId: number,
    userId: number,
    outputPath: string | null = null
  ): Promise<QueuedTaskHistory> {
    if (this.taskQueue.size >= this.config.ilastikQueueSize) {
      throw new ApiError(
        400,
        "Failed Attempt to queue label generation: Too many tasks in queue."
      );
    }

    const volume = await Volume.getByIdWithFileDeep(volumeId);

    IlastikHandler.checkVolumeProperties(volume);

    if (!outputPath) {
      outputPath = Utils.createTemporaryFolder(this.ilastikTempDirectory);
    }

    const multiLock = new WriteMultiLock([
      Volume.lockManager.generateLockInstance(volumeId, [
        RawVolumeData.modelName,
        SparseLabeledVolumeData.modelName,
        PseudoLabeledVolumeData.modelName,
      ]),
    ]);

    const defferedHistory = new Deferred<QueuedTaskHistory>();

    WriteMultiLock.withWriteMultiLock(multiLock, async () => {
      try {
        const task = new LabelGenerationTask(
          userId,
          this,
          volumeId,
          outputPath
        );

        const { taskHistory, executionPromise } =
          await this.taskQueue.enqueue(task);

        defferedHistory.resolve(taskHistory);

        return await executionPromise;
      } catch (error) {
        console.error(
          `Label generation task by User with id ${userId.toString()} failed to start: ${Utils.formatError(error)}`
        );
      }
    });

    return defferedHistory.promise;
  }

  async runIlastikInference(
    rawDataPath: string,
    modelPath: string,
    labelsOutputPath: string,
    logFile?: LogFile
  ): Promise<string> {
    return await this.ilastikModule.runInference(
      rawDataPath,
      modelPath,
      labelsOutputPath,
      logFile
    );
  }

  private async createIlastikProject(
    rawDataPath: string,
    sparseLabelPath: string,
    outputPath: string,
    logFile?: LogFile
  ): Promise<string> {
    return await this.ilastikModule.createProject(
      rawDataPath,
      sparseLabelPath,
      outputPath,
      logFile
    );
  }

  async generateLabels(
    volumeId: number,
    userId: number,
    outputPath: string,
    logFile?: LogFile
  ): Promise<PseudoLabelVolumeDataDB[] | undefined> {
    try {
      const volume = await Volume.getByIdWithFileDeep(volumeId);

      await logFile?.writeLog("Stating label generation process\n\n");

      IlastikHandler.checkVolumeProperties(volume);

      const rawH5FileName =
        Utils.stripExtension(volume.rawData.dataFile.rawFilePath) + ".h5";
      const labelsH5FileName =
        Utils.stripExtension(volume.rawData.dataFile.rawFilePath) +
        "_labels.h5";

      const rawH5Path = path.join(outputPath, rawH5FileName);
      const labelsH5Path = path.join(outputPath, labelsH5FileName);

      await logFile?.writeLog("Converting raw data to HDF5 format...\n");
      await this.convertDataToH5(
        volume.rawData,
        volume.sparseVolumes,
        rawH5Path,
        labelsH5Path,
        logFile
      );
      await logFile?.writeLog("Data conversion to HDF5 complete.");

      const modelFullPath = await this.createIlastikProject(
        rawH5Path,
        labelsH5Path,
        outputPath,
        logFile
      );

      const resultPath = await this.runIlastikInference(
        rawH5Path,
        modelFullPath,
        outputPath,
        logFile
      );

      const labelDirectory = path.join(outputPath, "labels");
      await fsPromises.mkdir(labelDirectory, {
        recursive: true,
      });
      await this.ilastikModule.H5ToLabels(
        resultPath,
        IlastikModule.pseudoLabelsDataset,
        labelDirectory,
        logFile
      );

      const pseudoLabeledVolumes = await Volume.addPseudoLabelsFromFolder(
        labelDirectory,
        userId,
        volume.id,
        volume.sparseVolumes
      );

      WebSocketManager.broadcastAction(
        [userId],
        [],
        ActionTypes.InsertPseudoVolumes,
        {
          pseudoLabeledVolumes: pseudoLabeledVolumes,
          volumeId: volumeId,
        }
      );

      return pseudoLabeledVolumes;
    } catch (error) {
      const errorMsg = Utils.formatError(error);
      console.error(`Ilastik label generation error: ${errorMsg}`);
      await logFile?.writeLog(`exec error: ${errorMsg}`);
      throw error;
    } finally {
      if (this.ilastikModule.shouldCleanTemporaryFiles()) {
        try {
          await fsPromises.rm(outputPath, {
            recursive: true,
            force: true,
          });
        } catch (error) {
          console.error(
            `Filed to remove ilastik inference cache: ${Utils.formatError(error)}`
          );
        }
      }
    }
  }

  private async convertDataToH5(
    rawData: CheckedVolume["rawData"],
    sparseLabelsStack: CheckedVolume["sparseVolumes"],
    rawOutputPath: string,
    labelsOutputPath: string,
    logFile?: LogFile
  ) {
    if (fileSystem.existsSync(rawOutputPath)) {
      await fsPromises.rm(rawOutputPath, {
        force: true,
      });
    }
    if (fileSystem.existsSync(labelsOutputPath)) {
      await fsPromises.rm(labelsOutputPath, {
        force: true,
      });
    }

    const dimensions = {
      x: rawData.sizeX,
      y: rawData.sizeY,
      z: rawData.sizeZ,
    };

    await this.ilastikModule.rawToH5(
      rawData.dataFile.rawFilePath,
      dimensions,
      rawData.usedBits,
      rawData.isSigned,
      rawData.isLittleEndian,
      rawOutputPath,
      IlastikModule.rawDataset,
      logFile
    );
    await this.ilastikModule.labelsToH5(
      sparseLabelsStack.map((l) => l.dataFile.rawFilePath),
      dimensions,
      labelsOutputPath,
      IlastikModule.labelsDataset,
      logFile
    );
  }

  private static checkDimensions(
    dim1: z.infer<typeof volumeSizeSchema>,
    dim2: z.infer<typeof volumeSizeSchema>
  ) {
    if (!Utils.checkDimensions(dim1, dim2)) {
      throw new ApiError(
        400,
        "Pseudo Labels Generation error: One or more inputs have missmatching dimensions."
      );
    }
  }

  private static checkVolumeProperties(
    volume: VolumeWithFileDeep
  ): asserts volume is CheckedVolume {
    if (volume.sparseVolumes.length < 2) {
      throw new ApiError(
        400,
        "Pseudo Labels Generation error: Volume requires at least two manual labels."
      );
    }

    if (
      volume.sparseVolumes.length + volume.pseudoVolumes.length >
      appConfig.maxVolumeChannels
    ) {
      throw new ApiError(
        400,
        "Pseudo Labels Generation error: Volume does not have enough empty space to pseudo label slots."
      );
    }

    if (!volume.rawData?.dataFile.rawFilePath) {
      throw new ApiError(
        400,
        "Pseudo Labels Generation error: Raw Data is missing."
      );
    }

    for (const sparseLabel of volume.sparseVolumes) {
      if (!sparseLabel?.dataFile.rawFilePath) {
        throw new ApiError(
          400,
          "Pseudo Labels Generation error: Manual Label Data is missing."
        );
      }
    }

    const dimensions = {
      x: volume.rawData.sizeX,
      y: volume.rawData.sizeY,
      z: volume.rawData.sizeZ,
    };
    for (const sparseLabel of volume.sparseVolumes) {
      if (sparseLabel.bytesPerVoxel != 1) {
        throw new ApiError(
          400,
          "Pseudo Labels Generation error: Labels must be in uint8 data format."
        );
      }
      IlastikHandler.checkDimensions(dimensions, {
        x: sparseLabel.sizeX,
        y: sparseLabel.sizeY,
        z: sparseLabel.sizeZ,
      });
    }
  }
}
