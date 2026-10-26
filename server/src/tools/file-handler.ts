// @ts-check

import Utils from "./utils";
import path from "path";
import AdmZip from "adm-zip";
import fileUpload from "express-fileupload";
import fileSystem from "fs";
import appConfig from "../tools/config";
import { rm } from "node:fs/promises";
import { ApiError } from "./error-handler";
import fsPromises from "fs/promises";

export class PendingUpload {
  /**
   * @returns {string}
   */
  get fileName() {
    throw new Error("Method not implemented");
  }

  /**
   * @returns {string}
   */
  get filteredFileName() {
    throw new Error("Method not implemented");
  }

  /**
   * @returns {string}
   */
  get fileExtension() {
    throw new Error("Method not implemented");
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async getData() {
    throw new Error("Method not implemented");
  }

  /**
   * @param {string} _folderPath
   * @param {string?} [_fileNameOverride]
   * @returns {Promise<string>}
   */
  async saveAs(_folderPath, _fileNameOverride = null) {
    throw new Error("Method not implemented");
  }
}

/**
 * @augments {PendingUpload}
 */
export class PendingFile extends PendingUpload {
  /**
   * @param {fileUpload.UploadedFile} file
   */
  constructor(file) {
    super();
    /** @type {fileUpload.UploadedFile} */
    this.file = file;
    Object.preventExtensions(this);
  }

  /**
   * @returns {string}
   */
  get fileName() {
    return this.file.name;
  }

  /**
   * @returns {string}
   */
  get filteredFileName() {
    return Utils.fileNameFilter(this.file.name);
  }

  /**
   * @returns {string}
   */
  get fileExtension() {
    return path.extname(this.file.name);
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async getData() {
    const contents = await fsPromises.readFile(this.file.tempFilePath);
    return contents;
  }

  /**
   * @param {string} folderPath
   * @param {string} [fileNameOverride]
   * @returns {Promise<string>}
   */
  async saveAs(folderPath, fileNameOverride = null) {
    const filteredFileName =
      fileNameOverride != null
        ? fileNameOverride
        : Utils.fileNameFilter(this.file.name);
    const fullPath = path.join(folderPath, filteredFileName);
    if (fileSystem.existsSync(fullPath)) {
      if (appConfig.safeMode) {
        throw new Error(
          `Error saving file: File with the same name already exists.`
        );
      } else {
        await rm(fullPath, { recursive: true, force: true });
      }
    }
    await this.file.mv(fullPath);
    return fullPath;
  }
}

/**
 * @augments {PendingUpload}
 */
export class PendingZipFile extends PendingUpload {
  /**
   * @param {AdmZip} zip
   * @param {AdmZip.IZipEntry} entry
   */
  constructor(zip, entry) {
    super();
    /** @type {AdmZip} */
    this.zip = zip;
    /** @type {AdmZip.IZipEntry} */
    this.entry = entry;
    Object.preventExtensions(this);
  }

  /**
   * @returns {string}
   */
  get fileName() {
    return this.entry.name;
  }

  /**
   * @returns {string}
   */
  get filteredFileName() {
    return Utils.fileNameFilter(this.entry.name);
  }

  /**
   * @returns {string}
   */
  get fileExtension() {
    return path.extname(this.entry.name);
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async getData() {
    return this.entry.getData();
  }

  /**
   * @param {string} folderPath
   * @param {string} [fileNameOverride]
   * @returns {Promise<string>}
   */
  async saveAs(folderPath, fileNameOverride = null) {
    const filteredFileName =
      fileNameOverride != null
        ? fileNameOverride
        : Utils.fileNameFilter(this.entry.name);
    const fullPath = path.join(folderPath, filteredFileName);

    if (!fileSystem.existsSync(folderPath)) {
      fileSystem.mkdirSync(folderPath, { recursive: true });
    }

    if (fileSystem.existsSync(fullPath)) {
      if (appConfig.safeMode) {
        throw new Error(
          `Error saving file: File with the same name already exists.`
        );
      } else {
        await rm(fullPath, { recursive: true, force: true });
      }
    }
    this.zip.extractEntryTo(
      this.entry,
      folderPath,
      false,
      true,
      false,
      filteredFileName
    );

    return fullPath;
  }
}

/**
 * @augments {PendingUpload}
 */
export class PendingLocalFile extends PendingUpload {
  /**
   * @param {string} path
   */
  constructor(path) {
    super();
    /** @type {string} */
    this.path = path;
    Object.preventExtensions(this);
  }

  /**
   * @returns {string}
   */
  get fileName() {
    return path.basename(this.path);
  }

  /**
   * @returns {string}
   */
  get filteredFileName() {
    return Utils.fileNameFilter(this.fileName);
  }

  /**
   * @returns {string}
   */
  get fileExtension() {
    return path.extname(this.fileName);
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async getData() {
    const contents = await fsPromises.readFile(this.path);
    return contents;
  }

  /**
   * @param {string} folderPath
   * @param {string} [fileNameOverride]
   * @returns {Promise<string>}
   */
  async saveAs(folderPath, fileNameOverride = null) {
    const filteredFileName =
      fileNameOverride != null
        ? fileNameOverride
        : Utils.fileNameFilter(this.fileName);
    const fullPath = path.join(folderPath, filteredFileName);
    if (fileSystem.existsSync(fullPath)) {
      if (appConfig.safeMode) {
        throw new Error(
          `Error saving file: File with the same name already exists.`
        );
      } else {
        await rm(fullPath, { recursive: true, force: true });
      }
    }
    await fsPromises.rename(this.path, fullPath);
    return fullPath;
  }
}

/**
 * @augments {PendingUpload}
 */
export class PendingData extends PendingUpload {
  /**
   * @param {Buffer} buffer
   * @param {string} fileName
   */
  constructor(buffer, fileName) {
    super();
    /** @type {Buffer} */
    this.buffer = buffer;
    /** @type {string} */
    this._fileName = fileName;
    Object.preventExtensions(this);
  }

  /**
   * @returns {string}
   */
  get fileName() {
    return path.basename(this._fileName);
  }

  /**
   * @returns {string}
   */
  get filteredFileName() {
    return Utils.fileNameFilter(this._fileName);
  }

  /**
   * @returns {string}
   */
  get fileExtension() {
    return path.extname(this._fileName);
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async getData() {
    return this.buffer;
  }

  /**
   * @param {string} folderPath
   * @param {string} [fileNameOverride]
   * @returns {Promise<string>}
   */
  async saveAs(folderPath, fileNameOverride = null) {
    const filteredFileName =
      fileNameOverride != null
        ? fileNameOverride
        : Utils.fileNameFilter(this.fileName);
    const fullPath = path.join(folderPath, filteredFileName);
    if (fileSystem.existsSync(fullPath)) {
      if (appConfig.safeMode) {
        throw new Error(
          `Error saving file: File with the same name already exists.`
        );
      } else {
        await rm(fullPath, { recursive: true, force: true });
      }
    }
    await fsPromises.writeFile(fullPath, await this.getData());
    return fullPath;
  }
}

/**
 * @param {fileUpload.UploadedFile | fileUpload.UploadedFile[]} files
 * @param {string[]?} acceptedExtensions
 * @returns {Promise<PendingUpload[]>}
 */
export async function unpackFiles(files, acceptedExtensions = []) {
  const result = [];

  if (!Array.isArray(files)) {
    files = [files];
  }

  for (const file of files) {
    if (path.extname(file.name) === ".zip") {
      const zipFileContents = await fsPromises.readFile(file.tempFilePath);
      let zip = new AdmZip(zipFileContents);
      const zipEntries = zip.getEntries();
      for (const entry of zipEntries) {
        if (Utils.isFileExtensionAccepted(entry.name, acceptedExtensions)) {
          result.push(new PendingZipFile(zip, entry));
        }
      }
    } else if (Utils.isFileExtensionAccepted(file.name, acceptedExtensions)) {
      result.push(new PendingFile(file));
    }
  }

  return result;
}

/**
 * @param {string[]} files
 * @param {string} outputName
 */
export function prepareDataForDownload(files, outputName) {
  if (files.length === 0) {
    throw new ApiError(404, `No files to download.`);
  }
  const zip = new AdmZip();
  for (const filePath of files) {
    zip.addLocalFile(filePath);
  }
  return {
    name: `${outputName}.zip`,
    zipBuffer: zip.toBuffer(),
  };
}
