import fs from "fs";
import path from "path";
import { ApiError } from "../tools/error-handler.mjs";

/**
 * Abstract base class for external modules/tools
 * Provides common interface for executing external scripts/executables
 */
export abstract class BaseModule {
  protected readonly moduleId: string = this.constructor.name;

  /**
   * Validate that a file or directory exists
   */
  protected validatePathExists(filePath: string): void {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new ApiError(
        500,
        `${this.moduleId} module: ${absolutePath} not found`
      );
    }
  }

  /**
   * Validate that a file exists
   */
  protected validateFileExists(filePath: string): void {
    this.validatePathExists(filePath);
    const absolutePath = path.resolve(filePath);
    if (!fs.statSync(absolutePath).isFile()) {
      throw new ApiError(
        500,
        `${this.moduleId} module: ${absolutePath} is not a file`
      );
    }
  }

  /**
   * Validate that a directory exists
   */
  protected validateDirectoryExists(dirPath: string): void {
    this.validatePathExists(dirPath);
    const absolutePath = path.resolve(dirPath);
    if (!fs.statSync(absolutePath).isDirectory()) {
      throw new ApiError(
        500,
        `${this.moduleId} module: ${absolutePath} is not a directory`
      );
    }
  }
}
