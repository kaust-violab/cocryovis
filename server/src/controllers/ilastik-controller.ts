import { idVolume } from "@cocryovis/schemas/componentSchemas/volume-schema";
import validateSchema from "../tools/validate-schema";
import type { Request, Response } from "express";
import type IlastikHandler from "../tools/ilastik-handler";
import { getSessionUser } from "../middleware/restrict";

export default class IlastikController {
  static async queuePseudoLabelsGeneration(
    ilastik: IlastikHandler,
    req: Request,
    res: Response
  ) {
    const { params } = validateSchema(req, { paramsSchema: idVolume });

    const taskHistory = await ilastik.queueLabelGeneration(
      params.idVolume,
      getSessionUser(req).id
    );

    res.json({ taskId: taskHistory.id });
  }
}
