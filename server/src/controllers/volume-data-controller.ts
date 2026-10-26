import { type Request, type Response } from "express";
import RawVolumeData from "../models/raw-volume-data";
import {
  VolumeDataFactory,
  VolumeDataType,
} from "../models/volume-data-factory";
import path from "path";
import { ApiError } from "../tools/error-handler";
import fileSystem from "fs";
import { ZipArchive } from "archiver";
import Utils from "../tools/utils";
import { PendingLocalFile, unpackFiles } from "../tools/file-handler";
import fsPromises from "node:fs/promises";
import SparseLabeledVolumeData from "../models/sparse-labeled-volume-data";
import appConfig from "../tools/config";
import validateSchema from "../tools/validate-schema";
import {
  fromUrlSchema,
  idVolumeAndType,
  idVolumeDataAndType,
  idVolumeVolumeDataTypeParams,
  volumeDataUpdate,
} from "@cocryovis/schemas/volume-data-path-schema";
import VolumeData from "../models/volume-data";
import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import Volume from "../models/volume";
import { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
import { getSessionUser } from "../middleware/restrict";

interface CreateFromFilesBody {
  settings: string;
  reconstructionParameters?: string;
}

export default class VolumeDataController {
  static getById = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const volumeData = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).getById(params.idVolumeData);

    res.json(volumeData);
  };

  static update = async (req: Request, res: Response) => {
    const { params, body } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
      bodySchema: volumeDataUpdate,
    });

    const volumeData = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).update(params.idVolumeData, body);
    res.status(200).json(volumeData);
  };

  static getData = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });
    const volumeData = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).getWithData(params.idVolumeData);

    if (!volumeData.dataFile.rawFilePath) {
      throw new ApiError(400, "Volume Data is missing a raw file.");
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(volumeData.dataFile.rawFilePath)}"`
    );
    const fileStream = fileSystem.createReadStream(
      volumeData.dataFile.rawFilePath
    );
    fileStream.pipe(res);

    fileStream.on("error", (err) => {
      console.error("File streaming error:", err);
      throw new ApiError(500, "Error reading file.");
    });
  };

  static getVolumeVisualizationFiles = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const volumeData = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).getWithData(params.idVolumeData);
    if (!volumeData.dataFile.rawFilePath) {
      throw new ApiError(
        400,
        "Visualisation requires the volume data to contain a .raw file."
      );
    }

    const volume = await Volume.getById(volumeData.volumeId);

    const archive = new ZipArchive({
      zlib: { level: appConfig.compressionLevel },
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="volume.zip"');
    archive.pipe(res);

    await Utils.packVisualizationArchive(
      archive,
      [VolumeData.toSettingSchema(volumeData, volume)],
      [volumeData.dataFile.rawFilePath]
    );

    void archive.finalize();
  };

  static createFromFiles = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeAndType,
      // bodySchema: volumeSettings,
    });

    if (!req.files?.rawFile) {
      throw new ApiError(400, "Missing files.");
    }

    let files = req.files.rawFile;
    if (!Array.isArray(files)) {
      files = [files];
    }

    const VolumeDataClass = VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    );

    const unpackedFiles = await unpackFiles(
      files,
      VolumeDataClass.acceptedFileExtensions
    );
    const {
      settings: settingsJson,
      reconstructionParameters: reconstructionParametersJson,
    } = req.body as CreateFromFilesBody;
    const settings = volumeSettings.parse(JSON.parse(settingsJson));
    const reconstructionParameters =
      reconstructionParametersJson !== undefined
        ? tiltSeriesOptions.parse(JSON.parse(reconstructionParametersJson))
        : undefined;

    const volumeData = await VolumeDataClass.createFromFiles(
      getSessionUser(req).id,
      params.idVolume,
      unpackedFiles,
      settings,
      { reconstructionParameters: reconstructionParameters }
    );

    res.status(201).json(volumeData);
  };

  static createFromMrcFile = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeAndType,
    });

    if (VolumeDataType.mapName(params.type) != VolumeDataType.RawVolumeData) {
      throw new ApiError(
        400,
        "This operation is only avaliable on Raw Volumes."
      );
    }

    if (!req.files?.files) {
      throw new ApiError(400, "No file uploaded");
    }

    if (Array.isArray(req.files.files)) {
      throw new ApiError(400, "Too many files uploaded.");
    }

    const unpackedFiles = await unpackFiles([req.files.files], [".mrc"]);
    if (unpackedFiles.length == 0) {
      throw new ApiError(400, "No valid MRC file found.");
    }

    const volumeData = await RawVolumeData.createFromMrcFile(
      getSessionUser(req).id,
      params.idVolume,
      unpackedFiles[0]
    );

    res.status(201).json(volumeData);
  };

  static createFromUrl = async (req: Request, res: Response) => {
    const { params, body } = validateSchema(req, {
      paramsSchema: idVolumeAndType,
      bodySchema: fromUrlSchema,
    });

    if (VolumeDataType.mapName(params.type) != VolumeDataType.RawVolumeData) {
      throw new ApiError(
        400,
        "This operation is only avaliable on Raw Volumes."
      );
    }

    const filePath = await Utils.downloadAndSaveFile(body.url);

    try {
      const file = new PendingLocalFile(filePath);
      let volumeData;

      if ((req.body as { fileType: string }).fileType === "mrc") {
        volumeData = await RawVolumeData.createFromMrcFile(
          getSessionUser(req).id,
          params.idVolume,
          file
        );
      } else {
        const settings = body.volumeSettings;
        if (!settings) {
          throw new ApiError(
            400,
            "Volume settings are required for raw files."
          );
        }

        volumeData = await RawVolumeData.createFromFiles(
          getSessionUser(req).id,
          params.idVolume,
          [file],
          settings
        );
      }

      res.status(201).json(volumeData);
    } catch (error) {
      await fsPromises.rm(filePath, {
        recursive: true,
        force: true,
      });

      throw error;
    }
  };

  static downloadFullVolumeData = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const data = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).prepareDataForDownload(params.idVolumeData);

    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.name}"`);
    data.archive.pipe(res);

    void data.archive.finalize();
  };

  static downloadRawFile = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const data = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).prepareDataForDownload(params.idVolumeData, true, false, false);

    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.name}"`);
    data.archive.pipe(res);

    void data.archive.finalize();
  };

  static downloadSettingsFile = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const data = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).prepareDataForDownload(params.idVolumeData, false, true, false);

    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.name}"`);
    data.archive.pipe(res);

    void data.archive.finalize();
  };

  static downloadMrcFile = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    if (VolumeDataType.mapName(params.type) !== VolumeDataType.RawVolumeData) {
      throw new ApiError(
        400,
        "This operation is only avaliable on Raw Volumes."
      );
    }
    const data = await RawVolumeData.prepareDataForDownload(
      params.idVolumeData,
      false,
      false,
      true
    );

    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.name}"`);
    data.archive.pipe(res);

    void data.archive.finalize();
  };

  static delete = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    await VolumeDataFactory.getClass(VolumeDataType.mapName(params.type)).del(
      params.idVolumeData
    );

    res.sendStatus(204);
  };

  static updateAnnotations = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeVolumeDataTypeParams,
      // bodySchema: updateAnnotationsSchema,
    });

    if (
      VolumeDataType.mapName(params.type) !==
      VolumeDataType.SparseLabeledVolumeData
    ) {
      throw new ApiError(
        400,
        "This operation is only avaliable on Manual Label Volumes."
      );
    }

    if (!req.files?.rawFile) {
      throw new ApiError(400, "Missing files.");
    }

    let files = req.files.rawFile;
    if (!Array.isArray(files)) {
      files = [files];
    }

    const unpackedFiles = await unpackFiles(files, ["raw"]);

    const rawFile = unpackedFiles.find((file) => file.fileExtension === ".raw");
    if (!rawFile) {
      throw new ApiError(400, "Missing .raw file.");
    }

    const sparseLabel = await SparseLabeledVolumeData.setRawData(
      params.idVolumeData,
      rawFile
    );

    res.json(sparseLabel);
  };
}
