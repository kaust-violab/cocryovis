import { ApiError } from "../tools/error-handler";
import { type Request, type Response } from "express";
import type ReconstructionHandler from "../tools/reconstruction-handler";
import { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";
import { getSessionUser } from "../middleware/restrict";

export default class PreProcessingController {
  static async queueTiltSeriesReconstruction(
    reconstructionHandler: ReconstructionHandler,
    req: Request,
    res: Response
  ) {
    // TODO make validateSchema work with multipart/form-data
    // const { body } = validateSchema(req, {
    //     bodySchema: tiltSeriesValidation,
    // });

    if (!req.files?.tiltSeries) {
      throw new ApiError(400, "No files uploaded.");
    }

    if (Array.isArray(req.files.tiltSeries)) {
      throw new ApiError(400, "Only one tilt series can be added to volume.");
    }

    if (!req.body) {
      throw new ApiError(400, "No data provided.");
    }
    const body = req.body as { data: string };

    const data = JSON.parse(body.data) as {
      options: unknown;
      volumeId: number;
    };

    const options = tiltSeriesOptions.parse(data.options);
    const volumeId = data.volumeId;

    const taskHistory =
      await reconstructionHandler.queueTiltSeriesReconstruction(
        req.files.tiltSeries,
        options,
        volumeId,
        getSessionUser(req).id
      );

    res.json({ id: taskHistory.id });
  }
}
