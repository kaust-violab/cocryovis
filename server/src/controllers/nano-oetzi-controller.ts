import {
  inferenceIds,
  trainingReq,
} from "@cocryovis/schemas/nano-oetzi-path-schema";
import validateSchema from "../tools/validate-schema";
import { type Request, type Response } from "express";
import type NanoOetziHandler from "../tools/nano-oetzi-handler.js";
import { getSessionUser } from "../middleware/restrict";

export default class NanoOetziController {
  static queueInference = async (
    nanoOetziHandler: NanoOetziHandler,
    req: Request,
    res: Response
  ) => {
    const { body } = validateSchema(req, { bodySchema: inferenceIds });

    const checkpointId = body.checkpointId;
    const volumeId = body.volumeId;

    const taskHistory = await nanoOetziHandler.queueInference(
      checkpointId,
      volumeId,
      getSessionUser(req).id
    );

    res.json({ taskId: taskHistory.id });
  };

  static queueTraining = async (
    nanoOetziHandler: NanoOetziHandler,
    req: Request,
    res: Response
  ) => {
    const { body } = validateSchema(req, { bodySchema: trainingReq });

    const taskHistory = await nanoOetziHandler.queueTraining(
      body.modelId,
      getSessionUser(req).id,
      body.trainingVolumes,
      body.validationVolumes,
      body.testingVolumes,
      body
    );

    res.json({ taskId: taskHistory.id });
  };
}
