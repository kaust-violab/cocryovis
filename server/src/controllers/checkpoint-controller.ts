import { type Request, type Response } from "express";
import Checkpoint from "../models/checkpoint";
import { ApiError } from "../tools/error-handler";
import { prepareDataForDownload } from "../tools/file-handler";
import path from "path";
import Utils from "../tools/utils";
import type fileUpload from "express-fileupload";
import { idCheckpoint } from "@cocryovis/schemas/componentSchemas/checkpoint-schema";
import validateSchema from "../tools/validate-schema";
import { idModel } from "@cocryovis/schemas/componentSchemas/model-schema";
import { getSessionUser } from "../middleware/restrict";

export default class CheckpointController {
  static getCheckpoint = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idCheckpoint });

    const checkpoint = await Checkpoint.getById(params.idCheckpoint);
    res.json(checkpoint);
  };

  static getCheckpointsFromModel = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idModel });

    const checkpoints = await Checkpoint.getFromModel(params.idModel);
    res.json(checkpoints);
  };

  static uploadCheckpoints = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idModel });

    if (!req.files?.files) {
      throw new ApiError(400, "No files uploaded.");
    }

    const checkpoints = await Checkpoint.createFromFiles(
      getSessionUser(req).id,
      params.idModel,
      Array.isArray(req.files.files) ? req.files.files : [req.files.files]
    );

    res.status(201).json(checkpoints);
  };

  static downloadCheckpoint = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idCheckpoint });

    const checkpoint = await Checkpoint.getById(params.idCheckpoint);
    if (!checkpoint.filePath) {
      throw new ApiError(404, "Checkpoint has no file to download.");
    }
    const data = prepareDataForDownload(
      [checkpoint.filePath],
      path.basename(checkpoint.filePath)
    );
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", "attachment; filename=" + data.name);
    res.send(data.zipBuffer);
  };

  static deleteCheckpoint = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idCheckpoint,
    });

    await Checkpoint.del(params.idCheckpoint);

    res.sendStatus(204);
  };

  static checkpointToText = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idCheckpoint });

    const checkpoint = await Checkpoint.getById(params.idCheckpoint);

    if (!checkpoint.filePath) {
      throw new ApiError(400, "Checkpoint is missing a file.");
    }

    const checkpointTxt = await Utils.ckptToText(checkpoint.filePath);

    res.send(checkpointTxt);
  };

  static checkpointFileToText = async (req: Request, res: Response) => {
    if (!req.files?.checkpoint) {
      throw new ApiError(400, "No files uploaded.");
    }

    if (Array.isArray(req.files.checkpoint)) {
      throw new ApiError(
        400,
        "Only one checkpoint file can be parsed at a time."
      );
    }

    const checkpointFile: fileUpload.UploadedFile = req.files.checkpoint;
    //FIXME bad error output
    const checkpointTxt = await Utils.ckptToText(checkpointFile.tempFilePath);

    res.send(checkpointTxt);
  };
}
