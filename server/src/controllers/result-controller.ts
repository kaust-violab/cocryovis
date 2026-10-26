import { type Request, type Response } from "express";
import Result from "../models/result";
import { ApiError } from "../tools/error-handler";
import { ZipArchive } from "archiver";
import Utils from "../tools/utils";
import appConfig from "../tools/config";
import { idResult } from "@cocryovis/schemas/componentSchemas/result-schema";
import validateSchema from "../tools/validate-schema";
import { idVolume } from "@cocryovis/schemas/componentSchemas/volume-schema";
import ResultVolume from "../models/result-volume";
import ResultDataFile from "../models/result-data-file";
import Volume from "../models/volume";
import type { createFromFilesSchema } from "@cocryovis/schemas/result-path-schema";
import type z from "zod";
import { getSessionUser } from "../middleware/restrict";

export default class ResultController {
  static getById = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idResult });

    const result = await Result.getById(params.idResult);

    res.json(result);
  };

  static getDetails = async (req: Request, res: Response) => {
    const result = await Result.getByIdDeep(Number(req.params.idResult), {
      checkpoint: true,
      resultVolumes: true,
    });

    res.json(result);
  };

  static getFromVolume = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idVolume });

    const result = await Result.getFromVolume(params.idVolume, {
      checkpoint: true,
    });

    res.json(result);
  };

  static delete = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idResult,
    });

    await Result.del(params.idResult);

    res.sendStatus(204);
  };

  static getResultData = async (req: Request, res: Response) => {
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

    res.attachment(`Result_${result.id.toString()}.zip`);
    archive.pipe(res);

    const fileReferences = result.resultVolumes;
    fileReferences.sort((a, b) => a.index - b.index);

    const settings = [];
    const rawFileNames: string[] = [];
    for (const reference of fileReferences) {
      const dataFile = await ResultDataFile.getById(reference.dataFileId);
      if (!dataFile.rawFilePath) {
        throw new ApiError(404, "Result volume is missing its raw file.");
      }

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

    void archive.finalize();
  };

  static createFromFiles = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idVolume });

    if (!req.files?.files) {
      throw new ApiError(400, "No file uploaded");
    }

    let files = req.files.files;
    if (!Array.isArray(files)) {
      files = [files];
    }
    const data = JSON.parse((req.body as { data: string }).data) as z.infer<
      typeof createFromFilesSchema
    >;

    const result = await Result.createFromFiles(
      getSessionUser(req).id,
      data.idCheckpoint,
      params.idVolume,
      data.volumeDescriptors,
      files
    );

    res.json(result);
  };
}
