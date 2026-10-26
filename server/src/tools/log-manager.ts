import appConfig from "../tools/config";
import path from "path";
import Utils from "./utils";
import fileSystem from "fs";

export default class LogFile {
  #filePath: string;

  static async createLogFile(basename: string): Promise<LogFile> {
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

  constructor(filePath: string) {
    this.#filePath = filePath;

    Object.preventExtensions(this);
  }

  get fileName() {
    return path.basename(this.#filePath);
  }

  exists() {
    return fileSystem.existsSync(this.#filePath);
  }

  async writeLog(data: string): Promise<void> {
    try {
      await fileSystem.promises.appendFile(this.#filePath, data);
    } catch (error) {
      console.error("Error writing log file: " + String(error));
    }
  }

  async moveTo(directory: string) {
    const newFilePath = path.join(directory, path.basename(this.#filePath));
    await fileSystem.promises.rename(this.#filePath, newFilePath);
    this.#filePath = newFilePath;
  }
}
