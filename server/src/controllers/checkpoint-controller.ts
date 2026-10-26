// @ts-check

import Checkpoint from "../models/checkpoint";
import { ApiError } from "../tools/error-handler";
import { prepareDataForDownload } from "../tools/file-handler";
import path from "path";
import Utils from "../tools/utils";
import fileUpload from "express-fileupload";
import { idCheckpoint } from "@cocryovis/schemas/componentSchemas/checkpoint-schema";
import validateSchema from "../tools/validate-schema";
import { idModel } from "@cocryovis/schemas/componentSchemas/model-schema";

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

export default class CheckpointController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getCheckpoint = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idCheckpoint });

    const checkpoint = await Checkpoint.getById(params.idCheckpoint);
    res.json(checkpoint);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getCheckpointsFromModel = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idModel });

    const checkpoints = await Checkpoint.getFromModel(params.idModel);
    res.json(checkpoints);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static uploadCheckpoints = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idModel });

    if (!req.files || !req.files.files) {
      throw new ApiError(400, "No files uploaded.");
    }

    const checkpoints = await Checkpoint.createFromFiles(
      Number(req.session.user.id),
      params.idModel,
      Array.isArray(req.files.files) ? req.files.files : [req.files.files]
    );

    res.status(201).json(checkpoints);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static downloadCheckpoint = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idCheckpoint });

    const checkpoint = await Checkpoint.getById(params.idCheckpoint);
    let data = prepareDataForDownload(
      [checkpoint.filePath],
      path.basename(checkpoint.filePath)
    );
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", "attachment; filename=" + data.name);
    res.send(data.zipBuffer);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static deleteCheckpoint = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idCheckpoint,
    });

    await Checkpoint.del(params.idCheckpoint);

    res.sendStatus(204);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static checkpointToText = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idCheckpoint });

    const checkpoint = await Checkpoint.getById(params.idCheckpoint);

    if (!checkpoint.filePath) {
      throw new ApiError(400, "Checkpoint is missing a file.");
    }

    const checkpointTxt = await Utils.ckptToText(checkpoint.filePath);

    res.send(checkpointTxt);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static checkpointFileToText = async (req, res) => {
    if (!req.files || !req.files.checkpoint) {
      throw new ApiError(400, "No files uploaded.");
    }

    if (Array.isArray(req.files.checkpoint)) {
      throw new ApiError(
        400,
        "Only one checkpoint file can be parsed at a time."
      );
    }

    /** @type {fileUpload.UploadedFile} */
    const checkpointFile = req.files.checkpoint;
    //FIXME bad error output
    const checkpointTxt = await Utils.ckptToText(checkpointFile.tempFilePath);

    res.send(checkpointTxt);
  };
}
