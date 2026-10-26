import fileSystem from "fs";
import path from "path";
import https from "https";
import { spawn } from "child_process";
import appConfig from "./config";
import fs from "fs";
import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import type z from "zod";
import type { Archiver } from "archiver";

export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

export default class Utils {
  static fileNameFilter(name: string) {
    return name.replace(/\s+/g, "_").replace(/[^\da-zA-Z_.-]+/g, "");
  }

  static isFileExtensionAccepted(
    filename: string,
    acceptedFileExtensions: string[]
  ) {
    return (
      acceptedFileExtensions.length === 0 ||
      acceptedFileExtensions.some((extension) => filename.endsWith(extension))
    );
  }

  static stripExtension(fileName: string): string {
    return path.parse(fileName).name;
  }

  static async mrcToRaw(inputFile: string, outputPath: string) {
    // prettier-ignore
    const params = [
      "-i", inputFile,
      "-o", outputPath
    ];

    const output = await Utils.runPythonScriptWithOutput(
      "mrc-to-raw.py",
      params
    );

    const data = volumeSettings.parse(JSON.parse(output));
    return {
      rawFileName: data.file,
      settings: data,
    };
  }

  static async analyzeToRaw(inputFile: string, outputPath: string) {
    // prettier-ignore
    const params = [
      "-i", inputFile,
      "-o", outputPath
    ];

    const output = await Utils.runPythonScriptWithOutput(
      "analyze-to-raw.py",
      params
    );

    const data = JSON.parse(output) as z.infer<typeof volumeSettings>;
    return {
      rawFileName: data.file,
      settings: data,
    };
  }

  static getInverseDateString(date = new Date()) {
    return (
      date.getUTCFullYear().toString() +
      "-" +
      ("0" + (date.getUTCMonth() + 1).toString()).slice(-2) +
      "-" +
      ("0" + date.getUTCDate().toString()).slice(-2) +
      "_" +
      ("0" + date.getUTCHours().toString()).slice(-2) +
      "-" +
      ("0" + date.getUTCMinutes().toString()).slice(-2) +
      "-" +
      ("0" + date.getUTCSeconds().toString()).slice(-2) +
      "-" +
      ("0" + date.getUTCMilliseconds().toString()).slice(-3)
    );
  }

  static generateUniqueFileName(filePath: string) {
    const folder = path.dirname(filePath);
    const fileName = Utils.stripExtension(filePath);
    const extension = path.extname(filePath);
    let counter = 1;

    while (fs.existsSync(filePath)) {
      filePath = path.join(
        folder,
        `${fileName}-${counter.toString()}${extension}`
      );
      counter++;
    }

    return path.basename(filePath);
  }

  static parseStringArray(array: string[] | string) {
    if (!Array.isArray(array)) {
      array = [array];
    }

    return array.map((s) => Number(s));
  }

  static createTemporaryFolder(basePath: string): string {
    let tempFolderPath = path.join(basePath, Utils.getInverseDateString());
    while (fileSystem.existsSync(tempFolderPath)) {
      tempFolderPath += "_";
    }
    fileSystem.mkdirSync(tempFolderPath, { recursive: true });
    return tempFolderPath;
  }

  static checkDimensions(dim1: Dimensions, dim2: Dimensions): boolean {
    return dim1.x == dim2.x && dim1.y == dim2.y && dim1.z == dim2.z;
  }

  static arrayToMap<T, K extends keyof T>(array: T[], key: K): Map<T[K], T> {
    const arrMap = new Map<T[K], T>();
    array.forEach((element) => {
      arrMap.set(element[key], element);
    });
    return arrMap;
  }

  static async meanFilter(
    rawFilePath: string,
    width: number,
    height: number,
    depth: number,
    outputPath: string,
    filterSize: number | null = null
  ): Promise<string> {
    const rawFileAbsolutePath = path.resolve(rawFilePath);
    const outputAbsolutePath = path.resolve(outputPath);

    const params: string[] = [
      `"${rawFileAbsolutePath}"`,
      width.toString(),
      height.toString(),
      depth.toString(),
      `"${outputAbsolutePath}"`,
    ];

    if (filterSize != null) {
      params.push(filterSize.toString());
    }

    await Utils.runPythonScript("mean-filter.py", params);

    return outputPath;
  }

  static async ckptToText(checkpointPath: string): Promise<string> {
    return Utils.runPythonScriptWithOutput("ckpt-to-text.py", [
      "-c",
      path.resolve(checkpointPath),
    ]);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- keep thrown errors as promise rejections
  static async packVisualizationArchive(
    archive: Archiver,
    settings: z.infer<typeof volumeSettings>[],
    rawFilePaths: string[],
    rawVolumeChannel: number | null = null
  ): Promise<void> {
    rawFilePaths.forEach((rawFilePath) => {
      archive.file(rawFilePath, {
        name: path.basename(rawFilePath),
      });
    });

    const settingsFileNames: string[] = [];

    for (const volumeSettings of settings) {
      // TODO restore transfer functions
      // if (volumeSettings.transferFunction) {
      //     const publicTFPath = path.join(
      //         "transfer-functions",
      //         volumeSettings.transferFunction
      //     );
      //     if (fileSystem.existsSync(publicTFPath)) {
      //         archive.file(publicTFPath, {
      //             name: path.join(
      //                 "transfer-functions",
      //                 volumeSettings.transferFunction
      //             ),
      //         });
      //     } else {
      //         delete volumeSettings.transferFunction;
      //     }
      // }

      const settingsFileName =
        Utils.stripExtension(volumeSettings.file) + ".json";

      archive.append(JSON.stringify(volumeSettings, null, 2), {
        name: settingsFileName,
      });

      settingsFileNames.push(settingsFileName);
    }

    const configData: { files: string[]; rawVolumeChannel?: number } = {
      files: settingsFileNames,
    };
    if (rawVolumeChannel) {
      configData.rawVolumeChannel = rawVolumeChannel;
    }

    archive.append(JSON.stringify(configData, null, 2), {
      name: `config.json`,
    });
  }

  static matchesTemplate(obj: object, template: object): boolean {
    return Object.keys(template).every((key) => {
      const templateValue = (template as Record<string, unknown>)[key];
      const objValue = (obj as Record<string, unknown>)[key];

      if (Array.isArray(templateValue)) {
        if (!Array.isArray(objValue)) return false;

        return objValue.every((item) =>
          Utils.matchesTemplate(item as object, templateValue[0] as object)
        );
      } else if (typeof templateValue === "object" && templateValue !== null) {
        return Utils.matchesTemplate(objValue as object, templateValue);
      } else {
        return typeof objValue === templateValue;
      }
    });
  }

  static isValidHttpUrl(string: string): boolean {
    let url: URL;

    try {
      url = new URL(string);
    } catch {
      return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
  }

  static async downloadFile(url: string, filePath: string): Promise<void> {
    try {
      const directory = path.dirname(filePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
      const fileStream = fs.createWriteStream(filePath);

      await new Promise<void>((resolve, reject) => {
        https
          .get(url, (response) => {
            if (response.statusCode !== 200) {
              reject(
                new Error(
                  `Failed to fetch ${url}: ${String(response.statusCode)}`
                )
              );
              return;
            }

            response.pipe(fileStream);
            fileStream.on("finish", () => {
              resolve();
            });
            fileStream.on("error", reject);
          })
          .on("error", reject);
      });

      console.log("Download complete");
    } catch (error) {
      void fs.promises.rm(filePath, {
        recursive: true,
        force: true,
      });
      throw error;
    }
  }

  static async downloadAndSaveFile(url: string): Promise<string> {
    const tempDir = path.join(appConfig.tempPath, "downloads");

    const originalFileName = path.basename(new URL(url).pathname);
    const ext = path.extname(originalFileName);
    const baseName = path.basename(originalFileName, ext);
    const uniqueName = `${baseName}_${Date.now().toString()}${ext}`;
    const filePath = path.join(tempDir, uniqueName);
    if (fs.existsSync(filePath)) {
      throw new Error("File already exists.");
    }

    await Utils.downloadFile(url, filePath);

    return filePath;
  }

  /**
   * Runs a script with arguments and optional output callbacks.
   * @param command - The command to run (e.g., "python").
   * @param args - Arguments to pass (e.g., ["script.py", "arg1", "arg2"]).
   * @param cwd - Optional working directory. Defaults to current directory.
   * @param [stdoutCallback] - Callback for stdout.
   * @param [stderrCallback] - Callback for stderr.
   * @param options
   */
  static async runScript(
    command: string,
    args: string[] = [],
    cwd: string | null = null,
    stdoutCallback: ((value: string) => void | Promise<void>) | null = null,
    stderrCallback: ((value: string) => void | Promise<void>) | null = null,
    {
      env,
      allowSoftFailCodes,
    }: { env?: NodeJS.ProcessEnv; allowSoftFailCodes?: number[] } = {}
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: env,
      });

      if (stdoutCallback) {
        child.stdout.on("data", (data: Buffer) => {
          void stdoutCallback(data.toString());
        });
      }

      if (stderrCallback) {
        child.stderr.on("data", (data: Buffer) => {
          void stderrCallback(data.toString());
        });
      }

      child.on("close", (code) => {
        // code is null when the process was terminated by a signal
        if (
          code === 0 ||
          (code !== null && allowSoftFailCodes?.includes(code))
        ) {
          if (code !== 0) {
            void stdoutCallback?.(
              `Warning: script exited with non-zero allowed code ${code.toString()}`
            );
          }
          resolve(code); //omit for this code
        } else {
          reject(
            new Error(
              `Subprocess exited with code ${String(code)}:\n${command} ${args.join(" ")}`
            )
          );
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to start script: ${err.message}`));
      });
    });
  }

  /**
   * Runs a Python script with arguments and optional output callbacks.
   * @param script - The Python script to run.
   * @param args - Arguments to pass to the script.
   * @param stdoutCallback - Callback for stdout.
   * @param stderrCallback - Callback for stderr.
   * @param pythonPath - Optional path to the Python executable.
   */
  static async runPythonScript(
    script: string,
    args: string[],
    stdoutCallback: ((value: string) => void) | null = null,
    stderrCallback: ((value: string) => void) | null = null,
    pythonPath: string = appConfig.python
  ): Promise<number> {
    const scriptPath = path.join("./python-scripts", script);
    return Utils.runScript(
      pythonPath,
      [scriptPath, ...args],
      null,
      stdoutCallback,
      stderrCallback
    );
  }

  /**
   * Runs a Python script with arguments and optional output callbacks.
   * @param script - The Python script to run.
   * @param args - Arguments to pass to the script.
   * @param pythonPath - Optional path to the Python executable.
   */
  static async runPythonScriptWithOutput(
    script: string,
    args: string[],
    pythonPath: string = appConfig.python
  ): Promise<string> {
    let errOutput = "";
    let output = "";

    try {
      await Utils.runPythonScript(
        script,
        args,
        (value) => (output += value),
        (value) => (errOutput += value),
        pythonPath
      );

      return output;
    } catch {
      throw new Error(
        "Failed to run python script: " + script + "\n" + errOutput
      );
    }
  }

  /**
   * Checks if a command line argument is present.
   * @param args - The command line arguments.
   * @param argName - The name of the argument to find (e.g., "--arg").
   */
  static hasArgument(args: string[], argName: string): boolean {
    const index = args.indexOf(argName);
    if (index !== -1) {
      return true;
    }
    return false;
  }

  static isFloat = (value: string | number): boolean => {
    const num = Number(value);
    return !Number.isNaN(num);
  };

  static isInteger = (value: string | number) => {
    const num = Number(value);
    return Number.isInteger(num);
  };

  static checkAndAddParameter<T extends { toString(): string }>(
    parameter: T,
    paramArray: string[],
    parameterName: string,
    condition: ((value: T) => boolean) | undefined = undefined,
    required = false
  ): void {
    if (parameter !== undefined && condition?.(parameter)) {
      paramArray.push(parameterName, parameter.toString());
    } else if (required) {
      throw new Error(
        `Parameter ${parameterName} is required and must be a valid value.`
      );
    }
  }

  static formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? error.message;
    }
    return typeof error === "string" ? error : JSON.stringify(error, null, 2);
  }
}
