import path from "path";
import { z } from "zod";
import Utils from "../tools/utils.mjs";
import { BaseModule } from "./base-module";
import { ApiError } from "../tools/error-handler.mjs";
import type LogFile from "../tools/log-manager.mjs";
import type { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";

export const proximalCryoETConfigSchema = z.object({
  path: z.string().min(1),
});

export type ProximalCryoETConfig = z.infer<typeof proximalCryoETConfigSchema>;

/**
 * Proximal_CryoET Module - Wraps CUDA_PROXIMAL_SART executable for 3D reconstruction
 */
export class ProximalCryoETModule extends BaseModule {
  protected proximalConfig: ProximalCryoETConfig;

  static readonly executablePath =
    "CUDA_PROXIMAL_SART/build/CUDA_PROXIMAL_SART";

  constructor(config: ProximalCryoETConfig) {
    super();
    this.proximalConfig = config;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    const executablePath = path.join(
      this.proximalConfig.path,
      ProximalCryoETModule.executablePath
    );
    this.validateFileExists(executablePath);
  }

  /**
   * Run 3D reconstruction using CUDA_PROXIMAL_SART
   */
  async runReconstruction(
    inputPath: string,
    outputPath: string,
    options: z.infer<typeof tiltSeriesOptions>,
    gpuId: number,
    logFile?: LogFile
  ): Promise<string> {
    if (!inputPath || !outputPath) {
      throw new ApiError(
        400,
        "Proximal_CryoET: Input path and output path are required"
      );
    }

    await logFile?.writeLog("Proximal_CryoET reconstruction started\n");

    const inputFileAbsolutePath = path.resolve(inputPath);
    const inputFileName = Utils.stripExtension(inputPath);
    const outputAbsolutePath = path.resolve(
      path.join(outputPath, inputFileName)
    );

    // prettier-ignore
    const params = [
      "filename", inputFileAbsolutePath,
      "result_filename", outputAbsolutePath,
      "gpu", gpuId.toString(),
    ];

    // Add reconstruction-specific parameters
    if (options.reconstruction) {
      for (const [key, value] of Object.entries(options.reconstruction)) {
        params.push(key);
        if (typeof value === "boolean") {
          params.push(value ? "1" : "0");
        } else {
          params.push(value.toString());
        }
      }
    }

    await Utils.runScript(
      path.join(this.proximalConfig.path, ProximalCryoETModule.executablePath),
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value)
    );

    await logFile?.writeLog(
      "\n--------------\nTilt series reconstruction finished\n\nConverting output to raw...\n"
    );

    return outputAbsolutePath;
  }
}
