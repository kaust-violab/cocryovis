import path from "path";
import Checkpoint from "../models/checkpoint";
import RawVolumeData from "../models/raw-volume-data";
import TaskHistory from "../models/task-history";
import Volume from "../models/volume";
import { ApiError } from "./error-handler";
import type GPUTaskHandler from "./gpu-task-handler";
import { WriteMultiLock, type WriteLock } from "./write-lock-manager";
import Utils from "./utils";
import type LogFile from "./log-manager";
import fs from "fs";
import Result, { type ResultConfig } from "../models/result";
import WebSocketManager, { ActionTypes } from "./websocket-manager";
import type { trainingOptions } from "@cocryovis/schemas/nano-oetzi-path-schema";
import type z from "zod";
import Model from "../models/model";
import PseudoLabeledVolumeData from "../models/pseudo-labeled-volume-data";
import type { volumeSizeSchema } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import { GPUTask } from "./gpu-task-handler";
import type GPUResourcesManager from "./gpu-resources-manager";
import { Deferred, type QueuedTaskHistory } from "./task-queue";
import moduleConfigLoader from "./module-config-loader";
import {
  nanoOetziConfigSchema,
  NanoOetziModule,
} from "../modules/nano-oetzi-module";

interface DeepVolume extends VolumeDB {
  rawData: RawVolumeDataWithFileDB | null;
  pseudoVolumes: PseudoVolumeDataWithFileDB[];
}

interface VolumeConfigData {
  name: string;
  rawDataPath: string;
  labels: string[];
}

class InferenceTask extends GPUTask<ResultDB> {
  protected logName = "inference";

  constructor(
    userId: number,
    private handler: NanoOetziHandler,
    private checkpointId: number,
    private volumeId: number,
    private outputPath: string | null,
    gpuManager: GPUResourcesManager
  ) {
    super(userId, gpuManager);
  }

  override taskHistoryData() {
    return {
      volumeId: this.volumeId,
      checkpointId: this.checkpointId,
      taskType: TaskHistory.type.Inference,
    };
  }

  override async execute(): Promise<ResultDB> {
    if (this.gpuId === null) {
      throw new ApiError(500, "Inference task error: GPU not acquired.");
    }
    return await this.handler.runInference(
      this.checkpointId,
      this.volumeId,
      this.userId,
      this.outputPath,
      this.gpuId,
      this.logFile
    );
  }
}

class TrainingTask extends GPUTask<CheckpointDB> {
  protected logName = "training";

  constructor(
    userId: number,
    private handler: NanoOetziHandler,
    private modelId: number,
    private trainingVolumesIds: number[],
    private validationVolumesIds: number[],
    private testingVolumesIds: number[],
    private params: z.infer<typeof trainingOptions>,
    private outputPath: string | null,
    gpuManager: GPUResourcesManager
  ) {
    super(userId, gpuManager);
  }

  override taskHistoryData() {
    return {
      modelId: this.modelId,
      taskType: TaskHistory.type.Training,
    };
  }

  override async execute(): Promise<CheckpointDB> {
    if (this.gpuId === null) {
      throw new ApiError(500, "Training task error: GPU not acquired.");
    }
    return await this.handler.runTraining(
      this.modelId,
      this.userId,
      this.trainingVolumesIds,
      this.validationVolumesIds,
      this.testingVolumesIds,
      this.params,
      this.outputPath,
      this.gpuId,
      this.logFile
    );
  }
}

export default class NanoOetziHandler {
  private static readonly tempDirectory = "nano-oetzi-tasks";
  private nanoOetziModule: NanoOetziModule;

  constructor(
    private gpuTaskHandler: GPUTaskHandler,
    private config: AppConfig
  ) {
    const nanoOetziConfig = nanoOetziConfigSchema.parse(
      moduleConfigLoader.getModuleConfig("NanoOetzi")
    );
    this.nanoOetziModule = new NanoOetziModule(nanoOetziConfig);
  }

  async queueInference(
    checkpointId: number,
    volumeId: number,
    userId: number,
    outputPath: string | null = null
  ): Promise<QueuedTaskHistory> {
    if (!this.gpuTaskHandler.canRunTask()) {
      throw new ApiError(
        400,
        "Failed Attempt to start inference: Too many tasks in queue."
      );
    }

    const volume = await Volume.getById(volumeId, { rawData: true });
    if (!volume.rawData) {
      throw new ApiError(
        400,
        `Inference: Selected Volume must contain Raw Volume Data.`
      );
    }

    const rawVolumeData = await RawVolumeData.getWithData(volume.rawData.id);
    const checkpoint = await Checkpoint.getById(checkpointId);

    NanoOetziHandler.checkInferenceRawData(rawVolumeData);
    NanoOetziHandler.checkInferenceCheckpoint(checkpoint);

    const multiLock = new WriteMultiLock([
      Checkpoint.lockManager.generateLockInstance(checkpointId),
      Volume.lockManager.generateLockInstance(volumeId, [
        RawVolumeData.modelName,
      ]),
    ]);

    const historyDeferred = new Deferred<QueuedTaskHistory>();

    WriteMultiLock.withWriteMultiLock(multiLock, async () => {
      try {
        const task = new InferenceTask(
          userId,
          this,
          checkpointId,
          volumeId,
          outputPath,
          this.gpuTaskHandler.gpuResourcesManager
        );

        const { taskHistory, executionPromise } =
          await this.gpuTaskHandler.queueGPUTask(task);

        historyDeferred.resolve(taskHistory);

        return await executionPromise;
      } catch (error) {
        console.error(
          `Inference task by User with id ${userId.toString()} failed.`,
          error
        );
      }
    });

    return historyDeferred.promise;
  }

  async runInference(
    checkpointId: number,
    volumeId: number,
    userId: number,
    outputPath: string | null,
    gpuId: number,
    logFile?: LogFile
  ): Promise<ResultDB> {
    let tempSettingsPath: string | null = null;

    if (!outputPath) {
      outputPath = this.createTemporaryOutputPath();
    }

    try {
      const rawVolumeData =
        await RawVolumeData.getFromVolumeIdWithData(volumeId);
      const checkpoint = await Checkpoint.getById(checkpointId);

      NanoOetziHandler.checkInferenceRawData(rawVolumeData);
      NanoOetziHandler.checkInferenceCheckpoint(checkpoint);

      if (!rawVolumeData.dataFile.path) {
        throw new ApiError(500, "Raw Volume Data has no folder on disk.");
      }
      tempSettingsPath = path.join(
        rawVolumeData.dataFile.path,
        `${Utils.stripExtension(rawVolumeData.dataFile.rawFilePath)}.json`
      );

      await NanoOetziModule.writeSettingsFile(
        rawVolumeData.dataFile.rawFilePath,
        rawVolumeData,
        tempSettingsPath
      );

      await fs.promises.mkdir(outputPath, { recursive: true });

      const inferenceDataAbsolutePath = path.resolve(tempSettingsPath);
      const outputAbsolutePath = path.resolve(outputPath);

      await this.nanoOetziModule.runInference(
        inferenceDataAbsolutePath,
        checkpoint.filePath,
        outputAbsolutePath,
        gpuId,
        logFile
      );

      const outputFile = await fs.promises.readFile(
        path.join(outputPath, "output.json"),
        "utf8"
      );

      const result = await Result.createFromFolder(
        userId,
        checkpointId,
        volumeId,
        JSON.parse(outputFile) as ResultConfig[],
        outputPath,
        logFile?.fileName
      );

      await logFile?.writeLog(
        `Result entry created.\n\nSaving task history...\n`
      );

      await logFile?.writeLog(`Task history saved.\n\nINFERENCE FINISHED!\n`);

      WebSocketManager.broadcastAction([userId], [], ActionTypes.InsertResult, {
        result: result,
        volumeId: volumeId,
      });

      return result;
    } catch (error: unknown) {
      const message = Utils.formatError(error);

      await logFile?.writeLog(`--------------\n${message}`);
      console.error(`NanoOetzi inference error: ${message}`);
      try {
        await fs.promises.rm(outputPath, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        const message = Utils.formatError(error);
        console.error(`Filed to remove nano oetzi inference cache: ${message}`);
      }
      throw error;
    } finally {
      if (tempSettingsPath != null) {
        try {
          await fs.promises.rm(tempSettingsPath, {
            force: true,
          });
        } catch {
          console.error(
            "Inference: Failed to remove the temporary setting file."
          );
        }
      }
    }
  }

  async queueTraining(
    modelId: number,
    userId: number,
    trainingVolumesIds: number[],
    validationVolumesIds: number[],
    testingVolumesIds: number[],
    params: z.infer<typeof trainingOptions>,
    outputPath: string | null = null
  ): Promise<QueuedTaskHistory> {
    if (!trainingVolumesIds || trainingVolumesIds.length == 0) {
      throw new ApiError(
        400,
        "Failed Attempt to start training: Missing training data."
      );
    }
    if (!validationVolumesIds || validationVolumesIds.length == 0) {
      throw new ApiError(
        400,
        "Failed Attempt to start training: Missing validation data."
      );
    }
    if (!testingVolumesIds || testingVolumesIds.length == 0) {
      throw new ApiError(
        400,
        "Failed Attempt to start training: Missing test data."
      );
    }
    if (!this.gpuTaskHandler.canRunTask()) {
      throw new ApiError(
        400,
        "Failed Attempt to start training: Too many tasks in queue."
      );
    }

    const model = await Model.getById(modelId, { checkpoints: true });
    if (!model) {
      throw new ApiError(
        400,
        "Failed Attempt to start training: Model not found."
      );
    }
    if (params.checkpointId === undefined && model.checkpoints.length > 0) {
      throw new ApiError(
        400,
        "If a checkpoint is not selected, the chosen model must be empty."
      );
    }

    if (params.checkpointId !== undefined) {
      const checkpoint = await Checkpoint.getById(params.checkpointId);
      let foundCheckpoint = false;
      for (const modelCheckpoint of model.checkpoints) {
        if (modelCheckpoint.id == checkpoint.id) {
          foundCheckpoint = true;
          break;
        }
      }
      if (!foundCheckpoint) {
        throw new ApiError(400, "Checkpoint not found in the selected model.");
      }

      if (!checkpoint) {
        throw new ApiError(404, "Checkpoint not found.");
      }
      if (!checkpoint.filePath) {
        throw new ApiError(404, "Checkpoint file not found.");
      }
    }

    this.checkTrainingInput(params);

    if (!outputPath) {
      outputPath = this.createTemporaryOutputPath();
    }

    const modelLock = Model.lockManager.generateLockInstance(modelId, [
      Checkpoint.modelName,
    ]);

    const volumeLocks: WriteLock[] = [];
    trainingVolumesIds.forEach((v) => {
      volumeLocks.push(
        Volume.lockManager.generateLockInstance(v, [
          RawVolumeData.modelName,
          PseudoLabeledVolumeData.modelName,
        ])
      );
    });

    validationVolumesIds.forEach((v) => {
      volumeLocks.push(
        Volume.lockManager.generateLockInstance(v, [
          RawVolumeData.modelName,
          PseudoLabeledVolumeData.modelName,
        ])
      );
    });

    testingVolumesIds.forEach((v) => {
      volumeLocks.push(
        Volume.lockManager.generateLockInstance(v, [
          RawVolumeData.modelName,
          PseudoLabeledVolumeData.modelName,
        ])
      );
    });

    const multiLock = new WriteMultiLock([modelLock, ...volumeLocks]);

    const deferredHistory = new Deferred<QueuedTaskHistory>();

    WriteMultiLock.withWriteMultiLock(multiLock, async () => {
      try {
        const task = new TrainingTask(
          userId,
          this,
          modelId,
          trainingVolumesIds,
          validationVolumesIds,
          testingVolumesIds,
          params,
          outputPath,
          this.gpuTaskHandler.gpuResourcesManager
        );

        const { taskHistory, executionPromise } =
          await this.gpuTaskHandler.queueGPUTask(task);

        deferredHistory.resolve(taskHistory);

        return await executionPromise;
      } catch (error) {
        console.error(
          `Training task by User with id ${userId.toString()} failed.`,
          error
        );
      }
    });

    return deferredHistory.promise;
  }

  private checkTrainingInput(params: z.infer<typeof trainingOptions>) {
    if (params.minEpochs < 1) {
      throw new ApiError(
        400,
        "Training error: Minimum epochs must be greater than 0."
      );
    }
    if (params.maxEpochs < 1) {
      throw new ApiError(
        400,
        "Training error: Maximum epochs must be greater than 0."
      );
    }
    if (params.minEpochs > params.maxEpochs) {
      throw new ApiError(
        400,
        "Training error: Maximum epochs must be greater than minimum epochs."
      );
    }
    if (params.batchSize < 1) {
      throw new ApiError(
        400,
        "Training error: Batch size must be greater than 0."
      );
    }
    if (params.learningRate <= 0) {
      throw new ApiError(
        400,
        "Training error: Learning rate must be greater than 0."
      );
    }
    if (!["mse", "bce", "awl"].includes(params.loss.toLowerCase())) {
      throw new ApiError(400, "Training error: Loss function not supported.");
    }
    if (params.accumulateGradients < 1) {
      throw new ApiError(
        400,
        "Training error: Accumulate gradients must be greater than 0."
      );
    }
    if (
      params.optimizer.toLowerCase() != "adam" &&
      params.optimizer.toLowerCase() != "ranger"
    ) {
      throw new ApiError(400, "Training error: Optimizer not supported.");
    }
  }

  async runTraining(
    modelId: number,
    userId: number,
    trainingVolumesIds: number[],
    validationVolumesIds: number[],
    testingVolumesIds: number[],
    params: z.infer<typeof trainingOptions>,
    outputPath: string | null,
    gpuId: number,
    logFile?: LogFile
  ): Promise<CheckpointDB> {
    if (!outputPath) {
      outputPath = this.createTemporaryOutputPath();
    }

    const workFolder = path.join(outputPath, "training-data");

    try {
      await logFile?.writeLog("Nano-Oetzi training started\n--------------\n");

      await fs.promises.mkdir(workFolder, { recursive: true });

      await logFile?.writeLog(`Creating training configuration file...\n`);

      const trainingVolumes =
        await Volume.getMultipleByIdWithFileDeep(trainingVolumesIds);
      const validationVolumes =
        await Volume.getMultipleByIdWithFileDeep(validationVolumesIds);
      const testingVolumes =
        await Volume.getMultipleByIdWithFileDeep(testingVolumesIds);

      const configPath = await this.writeTrainingConfigFile(
        trainingVolumes,
        validationVolumes,
        testingVolumes,
        workFolder
      );

      await logFile?.writeLog(
        `Training configuration file created successfully.\n`
      );

      const configAbsolutePath = path.resolve(configPath);
      const outputAbsolutePath = path.resolve(workFolder);

      await logFile?.writeLog("Converting raw data into pytorch tensors...\n");

      await Utils.runScript(
        this.config.python,
        [
          path.join("./python-scripts", "raws-to-train-sets.py"),
          "-i",
          configAbsolutePath,
          "-o",
          outputAbsolutePath,
        ],
        null,
        (value) => logFile?.writeLog(value),
        (value) => logFile?.writeLog(value)
      );

      await logFile?.writeLog(
        `\n--------------\nSuccess.\n\nLauching training script...\n`
      );

      let checkpointPath: string | undefined = undefined;
      if (params.checkpointId !== undefined) {
        const checkpoint = await Checkpoint.getById(params.checkpointId);
        if (!checkpoint) {
          throw new ApiError(400, "Training error: Checkpoint not found.");
        }
        if (!checkpoint.filePath) {
          throw new ApiError(400, "Training error: Checkpoint file not found.");
        }
        checkpointPath = checkpoint.filePath;
      }

      await this.nanoOetziModule.runTraining(
        configAbsolutePath,
        outputAbsolutePath,
        gpuId,
        params,
        checkpointPath,
        logFile
      );

      await logFile?.writeLog(
        `\n--------------\nSuccess.\n\nSearching for training results file...\n`
      );

      const trainingResultsPath = path.join(
        workFolder,
        "results",
        "result.json"
      );
      const trainingResults = await fs.promises.readFile(trainingResultsPath);
      const trainingResultsJSON = JSON.parse(trainingResults.toString()) as {
        best_model_path: string;
      };

      const bestModelPath = trainingResultsJSON.best_model_path;
      const newBestModelPath = path.join(
        outputPath,
        path.basename(bestModelPath)
      );

      await fs.promises.rename(bestModelPath, newBestModelPath);

      const labelIds: number[] = [];
      for (const trainingVolume of trainingVolumes) {
        for (const pseudoVolume of trainingVolume.pseudoVolumes) {
          labelIds.push(pseudoVolume.id);
        }
      }

      await logFile?.writeLog(
        `Training results file found.\n\nCreating new checkpoint...\n`
      );

      const checkpoint = await Checkpoint.createFromFolder(
        userId,
        modelId,
        labelIds,
        outputPath,
        newBestModelPath
      );

      await logFile?.writeLog(
        `New checkpoint created.\n\nSaving task history...\n`
      );

      await logFile?.writeLog(`Task history saved.\n\nTRAINING FINISHED!\n`);

      WebSocketManager.broadcastAction(
        [userId],
        [],
        ActionTypes.InsertCheckpoint,
        { checkpoint: checkpoint, modelId: modelId }
      );

      return checkpoint;
    } catch (error) {
      const message = Utils.formatError(error);
      await logFile?.writeLog(`ERROR: \n${message}`);
      console.error(`Nano Oetzi training error: ${message}`);
      try {
        await fs.promises.rm(workFolder, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        const message = Utils.formatError(error);
        console.error(
          `Failed to remove temporary files after a failed Nano-Oetzi training:\n${message}`
        );
      }
      throw error;
    } finally {
      if (this.nanoOetziModule.shouldCleanTrainingTemporaryFiles()) {
        try {
          await fs.promises.rm(workFolder, {
            recursive: true,
            force: true,
          });
        } catch (error) {
          const message = Utils.formatError(error);
          console.error(
            `Failed to remove temporary files after a failed Nano-Oetzi training:\n${message}`
          );
        }
      }
    }
  }

  private async writeTrainingConfigFile(
    trainingReferences: DeepVolume[],
    validationReferences: DeepVolume[],
    testReferences: DeepVolume[],
    outputPath: string
  ): Promise<string> {
    const configData: {
      train: VolumeConfigData[];
      valid: VolumeConfigData[];
      test: VolumeConfigData[];
      properties: {
        dimensions: z.infer<typeof volumeSizeSchema> | null;
        channels: number | null;
      };
    } = {
      train: [],
      valid: [],
      test: [],
      properties: {
        dimensions: null,
        channels: null,
      },
    };

    this.prepareTrainingConfigSet(
      trainingReferences,
      configData.train,
      configData.properties
    );
    this.prepareTrainingConfigSet(
      validationReferences,
      configData.valid,
      configData.properties
    );
    this.prepareTrainingConfigSet(
      testReferences,
      configData.test,
      configData.properties
    );

    const configFilePath = path.join(outputPath, "trainingConfig.json");
    await fs.promises.writeFile(
      configFilePath,
      JSON.stringify(configData, null, 2),
      "utf-8"
    );
    return configFilePath;
  }

  private prepareTrainingConfigSet(
    references: DeepVolume[],
    configDataArray: VolumeConfigData[],
    properties: {
      dimensions: z.infer<typeof volumeSizeSchema> | null;
      channels: number | null;
    }
  ) {
    for (const reference of references) {
      if (!reference.rawData) {
        throw new ApiError(
          400,
          "NanoOetzi inference error: One or more inputs are missing raw data."
        );
      }
      if (!reference.rawData.dataFile.rawFilePath) {
        throw new ApiError(
          400,
          "NanoOetzi inference error: raw data volume is missing."
        );
      }
      if (reference.pseudoVolumes.length == 0) {
        throw new ApiError(
          400,
          "NanoOetzi inference error: One or more inputs are missing raw data."
        );
      }

      if (reference.rawData.usedBits != 8) {
        throw new ApiError(
          400,
          "NanoOetzi inference error: One or more raw volume data inputs have an unsopported data format."
        );
      }

      const dimensions = {
        x: reference.rawData.sizeX,
        y: reference.rawData.sizeY,
        z: reference.rawData.sizeZ,
      };

      if (properties.dimensions == null) {
        properties.dimensions = dimensions;
      } else {
        NanoOetziHandler.checkDimensions(dimensions, properties.dimensions);
      }
      if (properties.channels == null) {
        properties.channels = reference.pseudoVolumes.length;
      } else {
        if (properties.channels != reference.pseudoVolumes.length) {
          throw new ApiError(
            400,
            "NanoOetzi inference error: One or more inputs have missmatching number of pseudo labels."
          );
        }
      }
      const volumeInput: {
        name: string;
        rawDataPath: string;
        labels: string[];
      } = {
        name: reference.name,
        rawDataPath: reference.rawData.dataFile.rawFilePath,
        labels: [],
      };

      for (const pseudoVolume of reference.pseudoVolumes) {
        if (!pseudoVolume.dataFile.rawFilePath) {
          throw new ApiError(
            400,
            "NanoOetzi inference error: One or more pseudo labeled volumes are missing a raw file."
          );
        }

        const dimensions = {
          x: pseudoVolume.sizeX,
          y: pseudoVolume.sizeY,
          z: pseudoVolume.sizeZ,
        };

        if (pseudoVolume.usedBits != 8) {
          throw new ApiError(
            400,
            "NanoOetzi inference error: One or more pseudo labeled volumes have an unsopported data format."
          );
        }
        NanoOetziHandler.checkDimensions(dimensions, properties.dimensions);
        volumeInput.labels.push(pseudoVolume.dataFile.rawFilePath);
      }

      configDataArray.push(volumeInput);
    }
  }

  private static checkDimensions(
    dim1: z.infer<typeof volumeSizeSchema>,
    dim2: z.infer<typeof volumeSizeSchema>
  ) {
    if (!Utils.checkDimensions(dim1, dim2)) {
      throw new ApiError(
        400,
        "NanoOetzi inference error: One or more inputs have missmatching dimensions."
      );
    }
  }

  private static checkInferenceRawData(
    rawVolumeData: RawVolumeDataWithFileDB | null
  ): asserts rawVolumeData is RawVolumeDataWithFileDB & {
    dataFile: { rawFilePath: string };
  } {
    if (!rawVolumeData) {
      throw new ApiError(
        400,
        `Inference: Selected Volume must contain Raw Volume Data.`
      );
    }
    if (!rawVolumeData.dataFile.rawFilePath) {
      throw new ApiError(
        400,
        `Inference: Raw Volume Data Volume must contain a raw file.`
      );
    }
  }

  private static checkInferenceCheckpoint(
    checkpoint: CheckpointDB
  ): asserts checkpoint is CheckpointDB & { filePath: string } {
    if (!checkpoint.filePath || !fs.existsSync(checkpoint.filePath)) {
      throw new ApiError(
        400,
        "Failed Attempt to start inference: Checkpoint file does not exist"
      );
    }
  }

  private createTemporaryOutputPath() {
    return Utils.createTemporaryFolder(
      path.join(this.config.tempPath, NanoOetziHandler.tempDirectory)
    );
  }
}
