// @ts-check

import fileSystem from "fs";
import path from "path";
import https from "https";
import { spawn } from "child_process";
import appConfig from "./config.mjs";
import fs from "fs";
import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";

/**
 * @import z from "zod"
 */
export default class Utils {
  /**
   * @param {string} name
   */
  static fileNameFilter(name) {
    return name.replace(/\s+/g, "_").replace(/[^\da-zA-Z_.-]+/g, "");
  }

  /**
   * @param {string} filename
   * @param {string[]} acceptedFileExtensions
   */
  static isFileExtensionAccepted(filename, acceptedFileExtensions) {
    return (
      acceptedFileExtensions.length === 0 ||
      acceptedFileExtensions.some((extension) => filename.endsWith(extension))
    );
  }

  /**
   * @param {string} fileName
   * @returns {string}
   */
  static stripExtension(fileName) {
    return path.parse(fileName).name;
  }

  /**
   * @param {string} inputFile
   * @param {string} outputPath
   */
  static async mrcToRaw(inputFile, outputPath) {
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

  /**
   * @param {string} inputFile
   * @param {string} outputPath
   */
  static async analyzeToRaw(inputFile, outputPath) {
    // prettier-ignore
    const params = [
      "-i", inputFile,
      "-o", outputPath
    ];

    const output = await Utils.runPythonScriptWithOutput(
      "analyze-to-raw.py",
      params
    );

    /** @type z.infer<typeof volumeSettings> */
    const data = JSON.parse(output);
    return {
      rawFileName: data.file,
      settings: data,
    };
  }

  static getInverseDateString(date = new Date()) {
    return (
      date.getUTCFullYear() +
      "-" +
      ("0" + (date.getUTCMonth() + 1)).slice(-2) +
      "-" +
      ("0" + date.getUTCDate()).slice(-2) +
      "_" +
      ("0" + date.getUTCHours()).slice(-2) +
      "-" +
      ("0" + date.getUTCMinutes()).slice(-2) +
      "-" +
      ("0" + date.getUTCSeconds()).slice(-2) +
      "-" +
      ("0" + date.getUTCMilliseconds()).slice(-3)
    );
  }

  /**
   * @param {string} filePath
   */
  static generateUniqueFileName(filePath) {
    const folder = path.dirname(filePath);
    const fileName = Utils.stripExtension(filePath);
    const extension = path.extname(filePath);
    let counter = 1;

    while (fs.existsSync(filePath)) {
      filePath = path.join(folder, `${fileName}-${counter}${extension}`);
      counter++;
    }

    return path.basename(filePath);
  }

  /**
   * @param {string[]} array
   */
  static parseStringArray(array) {
    if (!Array.isArray(array)) {
      array = [array];
    }

    return array.map((s) => Number(s));
  }

  /**
   * @param {string} basePath
   * @returns {string}
   */
  static createTemporaryFolder(basePath) {
    let tempFolderPath = path.join(basePath, Utils.getInverseDateString());
    while (fileSystem.existsSync(tempFolderPath)) {
      tempFolderPath += "_";
    }
    fileSystem.mkdirSync(tempFolderPath, { recursive: true });
    return tempFolderPath;
  }

  /**
   * @typedef {{x: number, y: number, z:number}} Dimensions
   * @param {Dimensions} dim1
   * @param {Dimensions} dim2
   * @returns {boolean}
   */
  static checkDimensions(dim1, dim2) {
    return dim1.x == dim2.x && dim1.y == dim2.y && dim1.z == dim2.z;
  }

  /**
   * @template T, K
   * @param {Array<T>} array
   * @param {K & keyof T} key
   * @returns {Map<T[K], T>}
   */
  static arrayToMap(array, key) {
    const arrMap = new Map();
    array.forEach((element) => {
      arrMap.set(element[key], element);
    });
    return arrMap;
  }

  /**
   * @param {string} rawFilePath
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {string} outputPath
   * @param {number} filterSize
   * @returns {Promise<string>}
   */
  static async meanFilter(
    rawFilePath,
    width,
    height,
    depth,
    outputPath,
    filterSize = null
  ) {
    const rawFileAbsolutePath = path.resolve(rawFilePath);
    const outputAbsolutePath = path.resolve(outputPath);

    /** @type {Array<string>} */
    const params = [
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

  /**
   * @param {string} checkpointPath
   * @returns {Promise<string>}
   */
  static async ckptToText(checkpointPath) {
    return Utils.runPythonScriptWithOutput("ckpt-to-text.py", [
      "-c",
      path.resolve(checkpointPath),
    ]);
  }

  /**
   * @param {import("archiver").Archiver} archive
   * @param {z.infer<typeof volumeSettings>[]} settings
   * @param {string[]} rawFilePaths
   * @param {number?} rawVolumeChannel
   * @returns {Promise<any>}
   */
  static async packVisualizationArchive(
    archive,
    settings,
    rawFilePaths,
    rawVolumeChannel = null
  ) {
    rawFilePaths.forEach((rawFilePath) => {
      archive.file(rawFilePath, {
        name: path.basename(rawFilePath),
      });
    });

    const settingsFileNames = [];

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

    const configData = { files: settingsFileNames };
    if (rawVolumeChannel) {
      configData.rawVolumeChannel = rawVolumeChannel;
    }

    archive.append(JSON.stringify(configData, null, 2), {
      name: `config.json`,
    });
  }

  /**
   * @param {object} obj
   * @param {object} template
   * @returns {boolean}
   */
  static matchesTemplate(obj, template) {
    return Object.keys(template).every((key) => {
      const templateValue = template[key];
      const objValue = obj[key];

      if (Array.isArray(templateValue)) {
        if (!Array.isArray(objValue)) return false;

        return objValue.every((item) =>
          Utils.matchesTemplate(item, templateValue[0])
        );
      } else if (typeof templateValue === "object" && templateValue !== null) {
        return Utils.matchesTemplate(objValue, templateValue);
      } else {
        return typeof objValue === templateValue;
      }
    });
  }

  /**
   * @param {string} string
   * @returns {boolean}
   */
  static isValidHttpUrl(string) {
    let url;

    try {
      url = new URL(string);
    } catch {
      return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
  }

  /**
   * @param {string} url
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  static async downloadFile(url, filePath) {
    try {
      const directory = path.dirname(filePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
      const fileStream = fs.createWriteStream(filePath);

      await new Promise((resolve, reject) => {
        https
          .get(url, (response) => {
            if (response.statusCode !== 200) {
              reject(
                new Error(`Failed to fetch ${url}: ${response.statusCode}`)
              );
              return;
            }

            response.pipe(fileStream);
            fileStream.on("finish", () => resolve());
            fileStream.on("error", reject);
          })
          .on("error", reject);
      });

      console.log("Download complete");
    } catch (error) {
      fs.promises.rm(filePath, {
        recursive: true,
        force: true,
      });
      throw error;
    }
  }

  /**
   * @param {string} url
   * @returns {Promise<string>}
   */
  static async downloadAndSaveFile(url) {
    const tempDir = path.join(appConfig.tempPath, "downloads");

    const originalFileName = path.basename(new URL(url).pathname);
    const ext = path.extname(originalFileName);
    const baseName = path.basename(originalFileName, ext);
    const uniqueName = `${baseName}_${Date.now()}${ext}`;
    const filePath = path.join(tempDir, uniqueName);
    if (fs.existsSync(filePath)) {
      throw new Error("File already exists.");
    }

    await Utils.downloadFile(url, filePath);

    return filePath;
  }

  /**
   * Runs a script with arguments and optional output callbacks.
   * @param {string} command - The command to run (e.g., "python").
   * @param {string[]} args - Arguments to pass (e.g., ["script.py", "arg1", "arg2"]).
   * @param {string} cwd - Optional working directory. Defaults to current directory.
   * @param {(value: string) => void | Promise<void> | null} [stdoutCallback] - Callback for stdout.
   * @param {(value: string) => void | Promise<void> | null} [stderrCallback] - Callback for stderr.
   * @param {{ env?: NodeJS.ProcessEnv, allowSoftFailCodes?: number[]}} options
   * @returns {Promise<number>}
   */
  static async runScript(
    command,
    args = [],
    cwd = null,
    stdoutCallback = null,
    stderrCallback = null,
    { env, allowSoftFailCodes } = {}
  ) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: env,
      });

      if (stdoutCallback) {
        child.stdout.on("data", (data) => {
          stdoutCallback(data.toString());
        });
      }

      if (stderrCallback) {
        child.stderr.on("data", (data) => {
          stderrCallback(data.toString());
        });
      }

      child.on("close", (code) => {
        if (
          code === 0 ||
          (allowSoftFailCodes && allowSoftFailCodes.includes(code))
        ) {
          if (code !== 0) {
            stdoutCallback(
              `Warning: script exited with non-zero allowed code ${code}`
            );
          }
          resolve(code); //omit for this code
        } else {
          reject(
            new Error(
              `Subprocess exited with code ${code}:\n${command} ${args.join(" ")}`
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
   * @param {string} script - The Python script to run.
   * @param {string[]} args - Arguments to pass to the script.
   * @param {(value: string) => void?} stdoutCallback - Callback for stdout.
   * @param {(value: string) => void?} stderrCallback - Callback for stderr.
   * @param {string} pythonPath - Optional path to the Python executable.
   * @returns {Promise<number>}
   */
  static async runPythonScript(
    script,
    args,
    stdoutCallback = null,
    stderrCallback = null,
    pythonPath = appConfig.python
  ) {
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
   * @param {string} script - The Python script to run.
   * @param {string[]} args - Arguments to pass to the script.
   * @param {string} pythonPath - Optional path to the Python executable.
   * @returns {Promise<string>}
   */
  static async runPythonScriptWithOutput(
    script,
    args,
    pythonPath = appConfig.python
  ) {
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
   * @param {string[]} args - The command line arguments.
   * @param {string} argName - The name of the argument to find (e.g., "--arg").
   * @returns {boolean}
   */
  static hasArgument(args, argName) {
    const index = args.indexOf(argName);
    if (index !== -1) {
      return true;
    }
    return false;
  }

  /**
   * @param {string | number} value
   * @returns {boolean}
   */
  static isFloat = (value) => {
    const num = Number(value);
    return !Number.isNaN(num);
  };

  /**
   * @param {string | number} value
   */
  static isInteger = (value) => {
    const num = Number(value);
    return Number.isInteger(num);
  };

  /**
   * @template T
   * @param {T} parameter
   * @param {string[]} paramArray
   * @param {string} parameterName
   * @param {(value: T) => boolean} [condition]
   * @param {boolean} [required]
   * @returns {void}
   */
  static checkAndAddParameter(
    parameter,
    paramArray,
    parameterName,
    condition = undefined,
    required = false
  ) {
    if (
      parameter !== undefined &&
      condition !== undefined &&
      condition(parameter)
    ) {
      paramArray.push(parameterName, parameter.toString());
    } else if (required) {
      throw new Error(
        `Parameter ${parameterName} is required and must be a valid value.`
      );
    }
  }

  /**
   * @param {unknown} error
   * @returns {string}
   */
  static formatError(error) {
    if (error instanceof Error) {
      return error.stack ?? error.message;
    }
    return typeof error === "string" ? error : JSON.stringify(error, null, 2);
  }
}
