import path from "path";
import { z } from "zod";
import Utils from "../tools/utils.mjs";
import { BaseModule } from "./base-module";
import { ApiError } from "../tools/error-handler.mjs";
import type LogFile from "../tools/log-manager.mjs";
import type { CTFOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";

export const gctfFindConfigSchema = z.object({
  path: z.string().min(1),
});

export type GCtfFindConfig = z.infer<typeof gctfFindConfigSchema>;

/**
 * GCtfFind Module - Wraps GCtfFind executable for CTF estimation
 */
export class GCtfFindModule extends BaseModule {
  protected gctfFindConfig: GCtfFindConfig;

  static readonly executablePath = "GCtfFind";

  constructor(config: GCtfFindConfig) {
    super();
    this.gctfFindConfig = config;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    this.validateDirectoryExists(this.gctfFindConfig.path);
    const executablePath = path.join(
      this.gctfFindConfig.path,
      GCtfFindModule.executablePath
    );
    this.validateFileExists(executablePath);
  }

  /**
   * Run CTF estimation on input file
   */
  async runCTFEstimation(
    inputPath: string,
    outputFolder: string,
    options: z.infer<typeof CTFOptions>,
    gpuId: number,
    logFile?: LogFile
  ): Promise<string> {
    if (!inputPath || !outputFolder) {
      throw new ApiError(
        400,
        "GCtfFind: Input path and output folder are required"
      );
    }

    await logFile?.writeLog("--------------STARTING CTF ESTIMATION\n");

    const baseName = Utils.stripExtension(inputPath);
    const inputAbsolutePath = path.resolve(inputPath);
    const outputPath = path.resolve(
      path.join(outputFolder, baseName + "_ctf.mrc")
    );

    // prettier-ignore
    const params = [
      "-InMrc", inputAbsolutePath,
      "-OutMrc", outputPath,
      "-Gpu", gpuId.toString(),
    ];

    // Add optional parameters
    Utils.checkAndAddParameter(
      options.highTension,
      params,
      "-kV",
      Utils.isFloat
    );
    Utils.checkAndAddParameter(
      options.sphericalAberration,
      params,
      "-Cs",
      Utils.isFloat
    );
    Utils.checkAndAddParameter(
      options.amplitudeContrast,
      params,
      "-AmpContrast",
      Utils.isFloat
    );
    Utils.checkAndAddParameter(
      options.pixelSize,
      params,
      "-PixSize",
      Utils.isFloat
    );
    Utils.checkAndAddParameter(
      options.tileSize,
      params,
      "-TileSize",
      Utils.isInteger
    );

    await Utils.runScript(
      path.join(this.gctfFindConfig.path, GCtfFindModule.executablePath),
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value)
    );

    await logFile?.writeLog("--------------CTF ESTIMATION FINISHED\n");
    return outputPath;
  }
}
