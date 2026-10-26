import path from "path";
import { z } from "zod";
import Utils from "../tools/utils.mjs";
import { BaseModule } from "./base-module";
import { ApiError } from "../tools/error-handler.mjs";
import type LogFile from "../tools/log-manager.mjs";
import type { IMODOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";

export const imodConfigSchema = z.object({
  path: z.string().min(1),
});

export type IMODConfig = z.infer<typeof imodConfigSchema>;

/**
 * IMOD Module - Wraps IMOD alignment tools
 * Handles: CCDERASER, EXTRACTTILTS, TILTXCORR, TILTALIGN, NEWSTACK
 */
export class IMODModule extends BaseModule {
  protected imodConfig: IMODConfig;

  static readonly imodRoot = "IMOD";
  static readonly binPath = path.join(IMODModule.imodRoot, "bin");

  constructor(config: IMODConfig) {
    super();
    this.imodConfig = config;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    this.validateDirectoryExists(this.imodConfig.path);
  }

  private getEnvironment(): NodeJS.ProcessEnv {
    return { IMOD_DIR: path.join(this.imodConfig.path, IMODModule.imodRoot) };
  }

  private getScriptPath(scriptName: string): string {
    return path.join(this.imodConfig.path, IMODModule.binPath, scriptName);
  }

  /**
   * Run complete tilt series alignment workflow
   */
  async runTiltSeriesAlignment(
    inputPath: string,
    outputFolder: string,
    options: z.infer<typeof IMODOptions>,
    logFile?: LogFile
  ): Promise<string> {
    if (!inputPath || !outputFolder) {
      throw new ApiError(
        400,
        "IMOD: Input path and output folder are required"
      );
    }

    await logFile?.writeLog(
      "--------------STARTING IMOD TILT SERIES ALIGNMENT\n"
    );

    const baseName = Utils.stripExtension(inputPath);
    const inputAbsolutePath = path.resolve(inputPath);

    // Step 1: CCDERASER
    const ccderaserOutputPath = await this.runCCDEraser(
      inputAbsolutePath,
      outputFolder,
      baseName,
      options,
      logFile
    );

    // Step 2: Extract tilt angles
    const extracttiltsOutputPath = await this.runExtractTilts(
      ccderaserOutputPath,
      outputFolder,
      baseName,
      logFile
    );

    // Step 3: Patch tracking with tiltxcorr
    const fidModelOutputPath = await this.runTiltXCorr(
      ccderaserOutputPath,
      outputFolder,
      baseName,
      extracttiltsOutputPath,
      options,
      logFile
    );

    // Step 4: Solve alignment with tiltalign
    const transformPath = await this.runTiltAlign(
      fidModelOutputPath,
      ccderaserOutputPath,
      extracttiltsOutputPath,
      outputFolder,
      baseName,
      options,
      logFile
    );

    // Step 5: Apply alignment with newstack
    const alignedPath = await this.runNewStackAlignment(
      ccderaserOutputPath,
      outputFolder,
      baseName,
      transformPath,
      logFile
    );

    await logFile?.writeLog(
      "--------------IMOD TILT SERIES ALIGNMENT FINISHED\n"
    );

    return alignedPath;
  }

  private async runCCDEraser(
    inputPath: string,
    outputFolder: string,
    baseName: string,
    options: z.infer<typeof IMODOptions>,
    logFile?: LogFile
  ): Promise<string> {
    await logFile?.writeLog("CCDERASER------\n");

    const outputPath = path.resolve(
      path.join(outputFolder, baseName + "_ccderaser.mrc")
    );

    const params = ["-input", inputPath, "-output", outputPath, "-find"];

    Utils.checkAndAddParameter(options.peak, params, "-peak", Utils.isFloat);
    Utils.checkAndAddParameter(options.diff, params, "-diff", Utils.isFloat);
    Utils.checkAndAddParameter(options.grow, params, "-grow", Utils.isFloat);
    Utils.checkAndAddParameter(
      options.iterations,
      params,
      "-iterations",
      Utils.isInteger
    );

    await Utils.runScript(
      this.getScriptPath("ccderaser"),
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value),
      { env: this.getEnvironment() }
    );

    await logFile?.writeLog("CCDERASER finished.\n");
    return outputPath;
  }

  private async runExtractTilts(
    inputPath: string,
    outputFolder: string,
    baseName: string,
    logFile?: LogFile
  ): Promise<string> {
    await logFile?.writeLog("EXTRACTTILTS------\n");

    const outputPath = path.resolve(
      path.join(outputFolder, baseName + "_tilts.tlt")
    );

    await Utils.runScript(
      this.getScriptPath("extracttilts"),
      ["-input", inputPath, "-output", outputPath],
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value),
      { env: this.getEnvironment() }
    );

    return outputPath;
  }

  private async runTiltXCorr(
    inputPath: string,
    outputFolder: string,
    baseName: string,
    extracttiltsOutputPath: string,
    options: z.infer<typeof IMODOptions>,
    logFile?: LogFile
  ): Promise<string> {
    await logFile?.writeLog("TILTXCORR------\n");

    const outputPath = path.resolve(
      path.join(outputFolder, baseName + "_patchtrack.fid")
    );

    const params = [inputPath, outputPath, "-tiltfile", extracttiltsOutputPath];

    Utils.checkAndAddParameter(
      options.numOfPatches,
      params,
      "-number",
      Utils.isInteger
    );
    Utils.checkAndAddParameter(
      options.patchSize,
      params,
      "-size",
      Utils.isInteger
    );
    Utils.checkAndAddParameter(
      options.patchRadius,
      params,
      "-radius1",
      Utils.isFloat
    );

    await Utils.runScript(
      this.getScriptPath("tiltxcorr"),
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value),
      { env: this.getEnvironment() }
    );

    return outputPath;
  }

  private async runTiltAlign(
    fidModelPath: string,
    ccderaserOutputPath: string,
    extracttiltsOutputPath: string,
    outputFolder: string,
    baseName: string,
    options: z.infer<typeof IMODOptions>,
    logFile?: LogFile
  ): Promise<string> {
    await logFile?.writeLog("TILTALIGN------\n");

    const transformPath = path.resolve(
      path.join(outputFolder, baseName + "_patchtrack.fid")
    );

    // prettier-ignore
    const params = [
      "-ModelFile", fidModelPath,
      "-ImageFile", ccderaserOutputPath,
      "-TiltFile", extracttiltsOutputPath,
      "-OutputTransformFile", transformPath,
    ];

    Utils.checkAndAddParameter(
      options.rotationAngle,
      params,
      "-RotationAngle",
      Utils.isFloat,
      true
    );

    await Utils.runScript(
      this.getScriptPath("tiltalign"),
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value),
      { allowSoftFailCodes: [139], env: this.getEnvironment() }
    );

    return transformPath;
  }

  private async runNewStackAlignment(
    ccderaserOutputPath: string,
    outputFolder: string,
    baseName: string,
    transformPath: string,
    logFile?: LogFile
  ): Promise<string> {
    await logFile?.writeLog("NEWSTACK------\n");

    const trimmedPath = path.resolve(
      path.join(outputFolder, baseName + "_trimmed.mrc")
    );

    await Utils.runScript(
      this.getScriptPath("newstack"),
      // prettier-ignore
      [
        "-secs", "1-56", 
        "-input", ccderaserOutputPath, 
        "-output", trimmedPath
      ],
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value),
      { env: this.getEnvironment() }
    );

    const alignedPath = path.resolve(
      path.join(outputFolder, baseName + "_aligned.mrc")
    );

    await Utils.runScript(
      this.getScriptPath("newstack"),
      // prettier-ignore
      [
        "-input", trimmedPath, 
        "-output", alignedPath, 
        "-xform", transformPath
      ],
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value),
      { env: this.getEnvironment() }
    );

    return alignedPath;
  }
}
