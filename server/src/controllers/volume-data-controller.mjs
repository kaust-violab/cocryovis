// @ts-check

import RawVolumeData from "../models/raw-volume-data.mjs";
import {
  VolumeDataFactory,
  VolumeDataType,
} from "../models/volume-data-factory.mjs";
import path from "path";
import { ApiError } from "../tools/error-handler.mjs";
import fileSystem from "fs";
import { ZipArchive } from "archiver";
import Utils from "../tools/utils.mjs";
import { PendingLocalFile, unpackFiles } from "../tools/file-handler.mjs";
import fsPromises from "node:fs/promises";
import SparseLabeledVolumeData from "../models/sparse-labeled-volume-data.mjs";
import appConfig from "../tools/config.mjs";
import validateSchema from "../tools/validate-schema.mjs";
import {
  fromUrlSchema,
  idVolumeAndType,
  idVolumeDataAndType,
  idVolumeVolumeDataTypeParams,
  volumeDataUpdate,
} from "@cocryovis/schemas/volume-data-path-schema";
import VolumeData from "../models/volume-data.mjs";
import { volumeSettings } from "@cocryovis/schemas/componentSchemas/volume-settings-schema";
import Volume from "../models/volume.mjs";
import { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";

/**
 * @import z from "zod"
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

export default class VolumeDataController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getById = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const volumeData = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).getById(params.idVolumeData);

    res.json(volumeData);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static update = async (req, res) => {
    const { params, body } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
      bodySchema: volumeDataUpdate,
    });

    const volumeData = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).update(params.idVolumeData, body);
    res.status(200).json(volumeData);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getData = async (req, res) => {
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

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getVolumeVisualizationFiles = async (req, res) => {
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

    archive.finalize();
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static createFromFiles = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeAndType,
      // bodySchema: volumeSettings,
    });

    if (!req.files || !req.files.rawFile) {
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
    const settings = volumeSettings.parse(JSON.parse(req.body.settings));
    const reconstructionParameters =
      req.body.reconstructionParameters !== undefined
        ? tiltSeriesOptions.parse(JSON.parse(req.body.reconstructionParameters))
        : undefined;

    const volumeData = await VolumeDataClass.createFromFiles(
      req.session.user.id,
      params.idVolume,
      unpackedFiles,
      settings,
      { reconstructionParameters: reconstructionParameters }
    );

    res.status(201).json(volumeData);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static createFromMrcFile = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeAndType,
    });

    if (VolumeDataType.mapName(params.type) != VolumeDataType.RawVolumeData) {
      throw new ApiError(
        400,
        "This operation is only avaliable on Raw Volumes."
      );
    }

    if (!req.files || !req.files.files) {
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
      req.session.user.id,
      params.idVolume,
      unpackedFiles[0]
    );

    res.status(201).json(volumeData);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static createFromUrl = async (req, res) => {
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

      if (req.body.fileType === "mrc") {
        volumeData = await RawVolumeData.createFromMrcFile(
          req.session.user.id,
          params.idVolume,
          file
        );
      } else {
        const settings = body.volumeSettings;

        volumeData = await RawVolumeData.createFromFiles(
          req.session.user.id,
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

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static downloadFullVolumeData = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const data = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).prepareDataForDownload(params.idVolumeData);

    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.name}"`);
    data.archive.pipe(res);

    data.archive.finalize();
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static downloadRawFile = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const data = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).prepareDataForDownload(params.idVolumeData, true, false, false);

    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.name}"`);
    data.archive.pipe(res);

    data.archive.finalize();
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static downloadSettingsFile = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    const data = await VolumeDataFactory.getClass(
      VolumeDataType.mapName(params.type)
    ).prepareDataForDownload(params.idVolumeData, false, true, false);

    res.type("application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.name}"`);
    data.archive.pipe(res);

    data.archive.finalize();
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static downloadMrcFile = async (req, res) => {
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

    data.archive.finalize();
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static delete = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolumeDataAndType,
    });

    await VolumeDataFactory.getClass(VolumeDataType.mapName(params.type)).del(
      params.idVolumeData
    );

    res.sendStatus(204);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static updateAnnotations = async (req, res) => {
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

    if (!req.files || !req.files.rawFile) {
      throw new ApiError(400, "Missing files.");
    }

    let files = req.files.rawFile;
    if (!Array.isArray(files)) {
      files = [files];
    }

    const unpackedFiles = await unpackFiles(files, ["raw"]);

    const rawFile = unpackedFiles.find((file) => file.fileExtension === ".raw");

    const sparseLabel = await SparseLabeledVolumeData.setRawData(
      params.idVolumeData,
      rawFile
    );

    res.json(sparseLabel);
  };
}
