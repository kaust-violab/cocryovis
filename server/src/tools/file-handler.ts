import Utils from "./utils";
import path from "path";
import AdmZip from "adm-zip";
import type fileUpload from "express-fileupload";
import fileSystem from "fs";
import appConfig from "../tools/config";
import { rm } from "node:fs/promises";
import { ApiError } from "./error-handler";
import fsPromises from "fs/promises";

export abstract class PendingUpload {
  abstract get fileName(): string;

  abstract get filteredFileName(): string;

  abstract get fileExtension(): string;

  abstract getData(): Promise<Buffer>;

  abstract saveAs(
    folderPath: string,
    fileNameOverride?: string | null
  ): Promise<string>;
}

export class PendingFile extends PendingUpload {
  declare file: fileUpload.UploadedFile;

  constructor(file: fileUpload.UploadedFile) {
    super();
    this.file = file;
    Object.preventExtensions(this);
  }

  override get fileName(): string {
    return this.file.name;
  }

  override get filteredFileName(): string {
    return Utils.fileNameFilter(this.file.name);
  }

  override get fileExtension(): string {
    return path.extname(this.file.name);
  }

  override async getData(): Promise<Buffer> {
    const contents = await fsPromises.readFile(this.file.tempFilePath);
    return contents;
  }

  override async saveAs(
    folderPath: string,
    fileNameOverride: string | null = null
  ): Promise<string> {
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

export class PendingZipFile extends PendingUpload {
  declare zip: AdmZip;
  declare entry: AdmZip.IZipEntry;

  constructor(zip: AdmZip, entry: AdmZip.IZipEntry) {
    super();
    this.zip = zip;
    this.entry = entry;
    Object.preventExtensions(this);
  }

  override get fileName(): string {
    return this.entry.name;
  }

  override get filteredFileName(): string {
    return Utils.fileNameFilter(this.entry.name);
  }

  override get fileExtension(): string {
    return path.extname(this.entry.name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- keep thrown errors as promise rejections
  override async getData(): Promise<Buffer> {
    return this.entry.getData();
  }

  override async saveAs(
    folderPath: string,
    fileNameOverride: string | null = null
  ): Promise<string> {
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

export class PendingLocalFile extends PendingUpload {
  declare path: string;

  constructor(path: string) {
    super();
    this.path = path;
    Object.preventExtensions(this);
  }

  override get fileName(): string {
    return path.basename(this.path);
  }

  override get filteredFileName(): string {
    return Utils.fileNameFilter(this.fileName);
  }

  override get fileExtension(): string {
    return path.extname(this.fileName);
  }

  override async getData(): Promise<Buffer> {
    const contents = await fsPromises.readFile(this.path);
    return contents;
  }

  override async saveAs(
    folderPath: string,
    fileNameOverride: string | null = null
  ): Promise<string> {
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

export class PendingData extends PendingUpload {
  declare buffer: Buffer;
  declare _fileName: string;

  constructor(buffer: Buffer, fileName: string) {
    super();
    this.buffer = buffer;
    this._fileName = fileName;
    Object.preventExtensions(this);
  }

  override get fileName(): string {
    return path.basename(this._fileName);
  }

  override get filteredFileName(): string {
    return Utils.fileNameFilter(this._fileName);
  }

  override get fileExtension(): string {
    return path.extname(this._fileName);
  }

  override getData(): Promise<Buffer> {
    return Promise.resolve(this.buffer);
  }

  override async saveAs(
    folderPath: string,
    fileNameOverride: string | null = null
  ): Promise<string> {
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

export async function unpackFiles(
  files: fileUpload.UploadedFile | fileUpload.UploadedFile[],
  acceptedExtensions: string[] = []
): Promise<PendingUpload[]> {
  const result: PendingUpload[] = [];

  if (!Array.isArray(files)) {
    files = [files];
  }

  for (const file of files) {
    if (path.extname(file.name) === ".zip") {
      const zipFileContents = await fsPromises.readFile(file.tempFilePath);
      const zip = new AdmZip(zipFileContents);
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

export function prepareDataForDownload(files: string[], outputName: string) {
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
