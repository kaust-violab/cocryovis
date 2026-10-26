import path from "path";
import Utils from "./utils";
import type LogFile from "./log-manager";
import Volume from "../models/volume";
import RawVolumeData from "../models/raw-volume-data";
import { WriteMultiLock } from "./write-lock-manager";
import { ApiError } from "./error-handler";
import WebSocketManager, { ActionTypes } from "./websocket-manager";
import { PendingLocalFile, unpackFiles } from "./file-handler";
import TaskHistory from "../models/task-history";
import type z from "zod";
import type fileUpload from "express-fileupload";
import type GPUTaskHandler from "./gpu-task-handler";
import fs from "fs";
import { GPUTask } from "./gpu-task-handler";
import type GPUResourcesManager from "./gpu-resources-manager";
import { Deferred, type QueuedTaskHistory } from "./task-queue";
import type { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
import moduleConfigLoader from "./module-config-loader";
import { imodConfigSchema, IMODModule } from "../modules/imod-module";
import {
  motionCor3ConfigSchema,
  MotionCor3Module,
} from "../modules/motion-cor3-module";
import {
  gctfFindConfigSchema,
  GCtfFindModule,
} from "../modules/gctf-find-module";
import {
  proximalCryoETConfigSchema,
  ProximalCryoETModule,
} from "../modules/proximal-cryoet-module";

class ReconstructionTask extends GPUTask<RawVolumeDataDB> {
  protected logName = "reconstruction";

  constructor(
    userId: number,
    gpuManager: GPUResourcesManager,
    private tiltSeriesFile: fileUpload.UploadedFile,
    private options: z.infer<typeof tiltSeriesOptions>,
    private volumeId: number,
    private reconstructionHandler: ReconstructionHandler
  ) {
    super(userId, gpuManager);
  }

  protected taskHistoryData(): RequireFields<
    Parameters<typeof TaskHistory.create>[0],
    "taskType"
  > {
    return {
      taskType: TaskHistory.type.Reconstruction,
      volumeId: this.volumeId,
    };
  }

  async execute(): Promise<RawVolumeDataDB> {
    if (this.gpuId === null) {
      throw new ApiError(500, "GPU not acquired for reconstruction task.");
    }
    return await this.reconstructionHandler.runTiltSeriesReconstruction(
      this.tiltSeriesFile,
      this.options,
      this.volumeId,
      this.userId,
      this.gpuId,
      {
        logFile: this.logFile,
      }
    );
  }
}

export default class ReconstructionHandler {
  private static readonly tempDirectory = "reconstruction-tasks";
  private imodModule: IMODModule;
  private motionCor3Module: MotionCor3Module;
  private gctfFindModule: GCtfFindModule;
  private proximalCryoETModule: ProximalCryoETModule;

  constructor(
    private gpuTaskHandler: GPUTaskHandler,
    private config: AppConfig
  ) {
    const imodConfig = imodConfigSchema.parse(
      moduleConfigLoader.getModuleConfig("IMOD")
    );
    const motionCor3Config = motionCor3ConfigSchema.parse(
      moduleConfigLoader.getModuleConfig("MotionCor3")
    );
    const gctfFindConfig = gctfFindConfigSchema.parse(
      moduleConfigLoader.getModuleConfig("GCtfFind")
    );
    const proximalCryoETConfig = proximalCryoETConfigSchema.parse(
      moduleConfigLoader.getModuleConfig("ProximalCryoET")
    );
    this.imodModule = new IMODModule(imodConfig);
    this.motionCor3Module = new MotionCor3Module(motionCor3Config);
    this.gctfFindModule = new GCtfFindModule(gctfFindConfig);
    this.proximalCryoETModule = new ProximalCryoETModule(proximalCryoETConfig);
  }

  async queueTiltSeriesReconstruction(
    tiltSeriesFile: fileUpload.UploadedFile,
    options: z.infer<typeof tiltSeriesOptions>,
    volumeId: number,
    userId: number
  ): Promise<QueuedTaskHistory> {
    if (!this.gpuTaskHandler.canRunTask()) {
      throw new ApiError(
        400,
        "Failed Attempt to start tilt series reconstruction: Too many tasks in queue."
      );
    }

    await this.validateReconstructionInput(tiltSeriesFile, options, volumeId);

    const multiLock = new WriteMultiLock([
      Volume.lockManager.generateLockInstance(volumeId, [
        RawVolumeData.modelName,
      ]),
    ]);

    const defferedHistory = new Deferred<QueuedTaskHistory>();

    WriteMultiLock.withWriteMultiLock(multiLock, async () => {
      try {
        const task = new ReconstructionTask(
          userId,
          this.gpuTaskHandler.gpuResourcesManager,
          tiltSeriesFile,
          options,
          volumeId,
          this
        );

        const { taskHistory, executionPromise } =
          await this.gpuTaskHandler.queueGPUTask(task);

        defferedHistory.resolve(taskHistory);

        return await executionPromise;
      } catch (error) {
        console.error(
          `Reconstruction task by User with id ${userId.toString()} failed, error: ${Utils.formatError(error)}`
        );
      }
    });

    return defferedHistory.promise;
  }

  private async validateReconstructionInput(
    _tiltSeriesFile: fileUpload.UploadedFile,
    _options: z.infer<typeof tiltSeriesOptions>,
    volumeId: number
  ): Promise<void> {
    const volume = await Volume.getById(volumeId);
    if (!volume) {
      throw new ApiError(
        400,
        "Failed Attempt to start tilt series reconstruction: Volume not found."
      );
    }
  }

  async runTiltSeriesReconstruction(
    tiltSeriesFile: fileUpload.UploadedFile,
    options: z.infer<typeof tiltSeriesOptions>,
    volumeId: number,
    userId: number,
    gpuId: number,
    { outputPath, logFile }: { outputPath?: string; logFile?: LogFile } = {}
  ): Promise<RawVolumeDataDB> {
    if (!outputPath) {
      outputPath = this.createTemporaryOutputPath();
    }

    let inputFile: string | undefined;
    try {
      await fs.promises.mkdir(outputPath, { recursive: true });
      const files = await unpackFiles(tiltSeriesFile);
      if (files.length === 0) {
        throw new ApiError(
          400,
          "Failed Attempt to start tilt series reconstruction: No valid tilt series file uploaded."
        );
      }
      const file = files[0];
      inputFile = await file.saveAs(outputPath);
    } catch (error) {
      const errorMessage = Utils.formatError(error);
      throw new ApiError(
        500,
        `Failed to save tilt series file: ${errorMessage}`
      );
    }

    try {
      await this.validateReconstructionInput(tiltSeriesFile, options, volumeId);

      let inputFileAbsolutePath = path.resolve(inputFile);

      if (options.alignment !== undefined) {
        inputFileAbsolutePath = await this.imodModule.runTiltSeriesAlignment(
          inputFileAbsolutePath,
          outputPath,
          options.alignment,
          logFile
        );
      }

      if (options.motionCorrection !== undefined) {
        inputFileAbsolutePath = await this.motionCor3Module.runMotionCorrection(
          inputFileAbsolutePath,
          outputPath,
          options.motionCorrection,
          gpuId,
          logFile
        );
      }

      if (options.ctf !== undefined) {
        inputFileAbsolutePath = await this.gctfFindModule.runCTFEstimation(
          inputFileAbsolutePath,
          outputPath,
          options.ctf,
          gpuId,
          logFile
        );
      }

      await logFile?.writeLog("Tilt series reconstruction started\n");

      const reconstructionOutputPath =
        await this.proximalCryoETModule.runReconstruction(
          inputFileAbsolutePath,
          outputPath,
          options,
          gpuId,
          logFile
        );

      const { rawFileName, settings } = await Utils.analyzeToRaw(
        reconstructionOutputPath + ".hdr",
        outputPath
      );

      const rawFilePath = path.join(outputPath, rawFileName);

      const rawData = await RawVolumeData.createFromFiles(
        userId,
        volumeId,
        [new PendingLocalFile(rawFilePath)],
        settings,
        { skipLock: true, reconstructionParameters: options }
      );

      await logFile?.writeLog(`Raw data created.\n\nSaving task history...\n`);

      WebSocketManager.broadcastAction([userId], [], ActionTypes.AddRawData, {
        volumeId: volumeId,
        rawData: rawData,
      });

      await logFile?.writeLog(
        `Task history saved.\n\nRECONSTRUCTION FINISHED!\n`
      );

      return rawData;
    } catch (error) {
      const errorMessage = Utils.formatError(error);
      await logFile?.writeLog(`ERROR: \n${errorMessage}`);
      console.error(`Tilt series reconstruction error: ${errorMessage}`);
      throw error;
    } finally {
      try {
        await fs.promises.rm(outputPath, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        const errorMessage = Utils.formatError(error);
        console.error(
          `Filed to remove nano oetzi inference cache: ${errorMessage}`
        );
      }
      try {
        await fs.promises.rm(tiltSeriesFile.tempFilePath, {
          force: true,
        });
      } catch {
        console.error(
          "Inference: Failed to remove the temporary setting file."
        );
      }
      try {
        await fs.promises.rm(inputFile, {
          force: true,
        });
      } catch {
        console.error(
          "Inference: Failed to remove the temporary setting file."
        );
      }
    }
  }

  private createTemporaryOutputPath() {
    return Utils.createTemporaryFolder(
      path.join(this.config.tempPath, ReconstructionHandler.tempDirectory)
    );
  }
}
