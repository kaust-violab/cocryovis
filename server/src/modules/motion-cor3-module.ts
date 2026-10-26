import path from "path";
import { z } from "zod";
import Utils from "../tools/utils.mjs";
import { BaseModule } from "./base-module";
import type { ModuleInstallContext } from "./base-module";
import { ApiError } from "../tools/error-handler.mjs";
import type LogFile from "../tools/log-manager.mjs";
import type { motionCorrectionOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";

export const motionCor3ConfigSchema = z.object({
  path: z.string().min(1),
});

const motionCor3InstallConfigSchema = z.object({
  cudaHome: z.string().min(1).optional(),
});

export type MotionCor3Config = z.infer<typeof motionCor3ConfigSchema>;

/**
 * MotionCor3 Module - Wraps MotionCor3 executable for motion correction
 */
export class MotionCor3Module extends BaseModule {
  protected motionCor3Config: MotionCor3Config;

  static readonly executablePath = "MotionCor3";

  constructor(config: MotionCor3Config) {
    super();
    this.motionCor3Config = config;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    const executablePath = path.join(
      this.motionCor3Config.path,
      MotionCor3Module.executablePath
    );
    this.validateFileExists(executablePath);
  }

  static override async installModule(
    moduleId: string,
    {
      modulesRoot,
      runCommand,
      getEnvValue,
      getModuleInstallConfig,
    }: ModuleInstallContext
  ): Promise<void> {
    const config = getModuleInstallConfig(
      moduleId,
      motionCor3InstallConfigSchema
    );
    const cudaHome =
      getEnvValue(["MOTIONCOR3_CUDA_HOME", "CUDA_HOME"]) ?? config.cudaHome;

    if (!cudaHome) {
      throw new Error(
        "Missing CUDA_HOME for MotionCor3. Set MOTIONCOR3_CUDA_HOME/CUDA_HOME environment variable or MotionCor3.cudaHome in module_config.json."
      );
    }

    const modulePath = path.join(modulesRoot, "motioncor3");
    await runCommand("make", ["clean"], { cwd: modulePath, allowFail: true });
    await runCommand(
      "make",
      ["exe", "-f", "makefile11", `CUDAHOME=${cudaHome}`],
      {
        cwd: modulePath,
      }
    );
  }

  /**
   * Run motion correction on input file
   */
  async runMotionCorrection(
    inputPath: string,
    outputFolder: string,
    options: z.infer<typeof motionCorrectionOptions>,
    gpuId: number,
    logFile?: LogFile
  ): Promise<string> {
    if (!inputPath || !outputFolder) {
      throw new ApiError(
        400,
        "MotionCor3: Input path and output folder are required"
      );
    }

    await logFile?.writeLog("--------------STARTING MOTION CORRECTION\n");

    const baseName = Utils.stripExtension(inputPath);
    const inputAbsolutePath = path.resolve(inputPath);
    const outputPath = path.resolve(
      path.join(outputFolder, baseName + "_motion_corrected.mrc")
    );

    // prettier-ignore
    const params = [
      "-InMrc", inputAbsolutePath,
      "-OutMrc", outputPath,
      "-Gpu", gpuId.toString(),
    ];

    // Add optional parameters
    if (options.patchSize !== undefined && Utils.isInteger(options.patchSize)) {
      params.push(
        "-Patch",
        options.patchSize.toString(),
        options.patchSize.toString()
      );
    }

    Utils.checkAndAddParameter(
      options.iterations,
      params,
      "-Iter",
      Utils.isInteger
    );
    Utils.checkAndAddParameter(
      options.tolerance,
      params,
      "-Tol",
      Utils.isFloat
    );
    Utils.checkAndAddParameter(
      options.pixelSize,
      params,
      "-PixSize",
      Utils.isFloat
    );
    Utils.checkAndAddParameter(
      options.fmDose,
      params,
      "-FmDose",
      Utils.isFloat
    );
    Utils.checkAndAddParameter(
      options.highTension,
      params,
      "-kV",
      Utils.isFloat
    );

    await Utils.runScript(
      path.join(this.motionCor3Config.path, MotionCor3Module.executablePath),
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value)
    );

    await logFile?.writeLog("--------------MOTION CORRECTION FINISHED\n");
    return outputPath;
  }
}
