import path from "path";
import { z } from "zod";
import Utils from "../tools/utils.mjs";
import { BaseModule } from "./base-module";
import { ApiError } from "../tools/error-handler.mjs";
import type LogFile from "../tools/log-manager.mjs";

export const ilastikConfigSchema = z.object({
  path: z.string().min(1),
  cleanTemporaryFiles: z.boolean().optional(),
});

export type IlastikConfig = z.infer<typeof ilastikConfigSchema>;

/**
 * Ilastik Module - Wraps Ilastik for label generation and inference
 */
export class IlastikModule extends BaseModule {
  static readonly rawDataset = "/raw_data";
  static readonly labelsDataset = "/labels";
  static readonly pseudoLabelsDataset = "/pseudo_labels";

  static readonly ilastikRoot = "ilastik";
  static readonly pythonPath = path.join(
    IlastikModule.ilastikRoot,
    "bin/python"
  );
  static readonly inferencePath = path.join(
    IlastikModule.ilastikRoot,
    "run_ilastik.sh"
  );
  static readonly createProjectPath = path.join(
    IlastikModule.ilastikRoot,
    "bin/train_headless.py"
  );
  static readonly modelFileName = "ilastik_project.ilp";

  protected ilastikConfig: IlastikConfig;

  constructor(config: IlastikConfig) {
    super();
    this.ilastikConfig = config;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    this.validateDirectoryExists(this.ilastikConfig.path);
    this.validateFileExists(
      path.join(this.ilastikConfig.path, IlastikModule.pythonPath)
    );
    this.validateFileExists(
      path.join(this.ilastikConfig.path, IlastikModule.inferencePath)
    );
    this.validateFileExists(
      path.join(this.ilastikConfig.path, IlastikModule.createProjectPath)
    );
  }

  /**
   * Run Ilastik headless inference on raw data with trained model
   */
  async runInference(
    rawDataPath: string,
    modelPath: string,
    labelsOutputPath: string,
    logFile: LogFile
  ): Promise<string> {
    if (!rawDataPath || !modelPath || !labelsOutputPath) {
      throw new ApiError(
        400,
        "Ilastik: Raw data path, model path, and output path are required"
      );
    }

    await logFile.writeLog("\n\nIlastik inference started\n");

    const rawDataFullPath =
      path.resolve(rawDataPath) + IlastikModule.rawDataset;
    const modelFullPath = path.resolve(modelPath);
    const resultsFilePath = path.join(
      labelsOutputPath,
      `${Utils.stripExtension(rawDataPath)}_pseudo_labels.h5`
    );

    const inferenceParams = [
      "--headless",
      `--project=${modelFullPath}`,
      "--output_format=hdf5",
      "--export_source=Probabilities",
      "--export_dtype=uint8",
      "--pipeline_result_drange=(0.0,1.0)",
      "--export_drange=(0,255)",
      `--output_internal_path=${IlastikModule.pseudoLabelsDataset}`,
      `--output_filename_format=${resultsFilePath}`,
      rawDataFullPath,
    ];

    await Utils.runScript(
      this.ilastikConfig.path + IlastikModule.inferencePath,
      inferenceParams,
      null,
      (value) => logFile.writeLog(value),
      (value) => logFile.writeLog(value)
    );

    return resultsFilePath;
  }

  /**
   * Create a new Ilastik project from raw data and sparse labels
   */
  async createProject(
    rawDataPath: string,
    sparseLabelPath: string,
    outputPath: string,
    logFile: LogFile
  ): Promise<string> {
    if (!rawDataPath || !sparseLabelPath || !outputPath) {
      throw new ApiError(
        400,
        "Ilastik: Raw data, sparse labels, and output paths are required"
      );
    }

    await logFile.writeLog("\n\nCreating Ilastik project\n");

    const modelOutputFullPath = path.join(
      path.resolve(outputPath),
      IlastikModule.modelFileName
    );
    const rawDataFullPath =
      path.resolve(rawDataPath) + IlastikModule.rawDataset;
    const sparseLabelFullPath =
      path.resolve(sparseLabelPath) + IlastikModule.labelsDataset;

    const projectParams = [
      path.join(this.ilastikConfig.path, IlastikModule.createProjectPath),
      modelOutputFullPath,
      rawDataFullPath,
      sparseLabelFullPath,
    ];

    await Utils.runScript(
      this.ilastikConfig.path + IlastikModule.pythonPath,
      projectParams,
      null,
      (value) => logFile.writeLog(value),
      (value) => logFile.writeLog(value)
    );

    return modelOutputFullPath;
  }

  /**
   * Check if temporary files should be cleaned up based on config
   */
  shouldCleanTemporaryFiles(): boolean {
    return this.ilastikConfig.cleanTemporaryFiles ?? true;
  }

  async rawToH5(
    rawVolumePath: string,
    dimensions: { x: number; y: number; z: number },
    usedBits: number,
    isSigned: boolean,
    littleEndian: boolean,
    outputPath: string,
    datasetName: string,
    logFile?: LogFile
  ) {
    // prettier-ignore
    const params = [
      path.join("./python-scripts", "raw-to-h5.py"),
      "-r", rawVolumePath,
      "-d", `${dimensions.x.toString()}x${dimensions.y.toString()}x${dimensions.z.toString()}`,
      "-b", usedBits.toString(),
      "-sg", isSigned.toString(),
      "-le", littleEndian.toString(),
      "-s", datasetName,
      "-o", outputPath
    ]

    await Utils.runScript(
      this.ilastikConfig.path + IlastikModule.pythonPath,
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value)
    );

    return outputPath;
  }

  async labelsToH5(
    labelPaths: string[],
    dimensions: { x: number; y: number; z: number },
    outputPath: string,
    datasetName: string,
    logFile?: LogFile
  ) {
    // prettier-ignore
    const params = [
      path.join("./python-scripts", "labels-to-h5.py"),
      "-l", ...labelPaths,
      "-d", `${dimensions.x.toString()}x${dimensions.y.toString()}x${dimensions.z.toString()}`,
      "-s", datasetName,
      "-o", outputPath,
      "-log", "True"
    ];

    await Utils.runScript(
      this.ilastikConfig.path + IlastikModule.pythonPath,
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value)
    );

    return outputPath;
  }

  /**
   * @param {string} labelPath
   * @param {string} datasetName
   * @param {string} outputPath
   * @param {LogFile} logFile
   */
  async H5ToLabels(
    labelPath: string,
    datasetName: string,
    outputPath: string,
    logFile?: LogFile
  ) {
    // prettier-ignore
    const params = [
      path.join("./python-scripts", "h5-to-labels.py"),
      "-l", labelPath,
      "-s", datasetName,
      "-o", outputPath
    ];

    await Utils.runScript(
      this.ilastikConfig.path + IlastikModule.pythonPath,
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value)
    );

    return outputPath;
  }
}
