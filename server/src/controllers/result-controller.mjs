// @ts-check

import Result from "../models/result.mjs";
import { ApiError } from "../tools/error-handler.mjs";
import { ZipArchive } from "archiver";
import Utils from "../tools/utils.mjs";
import appConfig from "../tools/config.mjs";
import { idResult } from "@cocryovis/schemas/componentSchemas/result-schema";
import validateSchema from "../tools/validate-schema.mjs";
import { idVolume } from "@cocryovis/schemas/componentSchemas/volume-schema";
import ResultVolume from "../models/result-volume.mjs";
import ResultDataFile from "../models/result-data-file.mjs";
import Volume from "../models/volume.mjs";

/**
 * @import { createFromFilesSchema } from "@cocryovis/schemas/result-path-schema"
 * @import z from "zod"
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

export default class ResultController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getById = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idResult });

    const result = await Result.getById(params.idResult);

    res.json(result);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getDetails = async (req, res) => {
    const result = await Result.getByIdDeep(Number(req.params.idResult), {
      checkpoint: true,
      resultVolumes: true,
    });

    res.json(result);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getFromVolume = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idVolume });

    const result = await Result.getFromVolume(params.idVolume, {
      checkpoint: true,
    });

    res.json(result);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static delete = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idResult,
    });

    await Result.del(params.idResult);

    res.sendStatus(204);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getResultData = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idResult });

    const result = await Result.getByIdDeep(params.idResult, {
      resultVolumes: true,
    });

    const parentVolume = await Volume.getById(result.volumeId);

    if (result.resultVolumes.length === 0) {
      throw new ApiError(
        400,
        "Visualisation requires the result to contain at least one file."
      );
    }

    const archive = new ZipArchive({
      zlib: { level: appConfig.compressionLevel },
    });

    res.attachment(`Result_${result.id}.zip`);
    archive.pipe(res);

    const fileReferences = result.resultVolumes;
    fileReferences.sort((a, b) => a.index - b.index);

    const settings = [];
    const rawFileNames = [];
    for (const reference of fileReferences) {
      const dataFile = await ResultDataFile.getById(reference.dataFileId);

      const settingsReference = ResultVolume.toSettingSchema(
        {
          ...reference,
          dataFile,
        },
        parentVolume
      );
      settings.push(settingsReference);

      rawFileNames.push(dataFile.rawFilePath);
    }

    await Utils.packVisualizationArchive(
      archive,
      settings,
      rawFileNames,
      result.rawVolumeChannel
    );

    archive.finalize();
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static createFromFiles = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idVolume });

    if (!req.files || !req.files.files) {
      throw new ApiError(400, "No file uploaded");
    }

    let files = req.files.files;
    if (!Array.isArray(files)) {
      files = [files];
    }
    /** @type {z.infer<typeof createFromFilesSchema> }    */
    const data = JSON.parse(req.body.data);

    const result = await Result.createFromFiles(
      req.session.user.id,
      data.idCheckpoint,
      params.idVolume,
      data.volumeDescriptors,
      files
    );

    res.json(result);
  };
}
