// @ts-check

import appConfig from "../tools/config";
import path from "path";
import Utils from "./utils";
import fileSystem from "fs";

export default class LogFile {
  /** @type {string} */ #filePath;

  /**
   * @param {string} basename
   * @returns {Promise<LogFile>}
   */
  static async createLogFile(basename) {
    await fileSystem.promises.mkdir(appConfig.logPath, { recursive: true });

    let logPath = Utils.getInverseDateString() + "_" + basename;
    logPath = path.join(appConfig.logPath, logPath);
    while (fileSystem.existsSync(logPath + ".log")) {
      logPath += "_";
    }
    logPath += ".log";
    await fileSystem.promises.writeFile(logPath, "");
    return new LogFile(logPath);
  }

  /**
   * @param {string} filePath
   */
  constructor(filePath) {
    this.#filePath = filePath;

    Object.preventExtensions(this);
  }

  get fileName() {
    return path.basename(this.#filePath);
  }

  exists() {
    return fileSystem.existsSync(this.#filePath);
  }

  /**
   * @param {string} data
   * @returns {Promise<void>}
   */
  async writeLog(data) {
    try {
      return await fileSystem.promises.appendFile(this.#filePath, data);
    } catch (error) {
      console.error("Error writing log file: " + error);
    }
  }

  /**
   * @param {string} directory
   */
  async moveTo(directory) {
    const newFilePath = path.join(directory, path.basename(this.#filePath));
    await fileSystem.promises.rename(this.#filePath, newFilePath);
    this.#filePath = newFilePath;
  }
}
