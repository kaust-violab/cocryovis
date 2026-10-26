import { idTomogram } from "@cocryovis/schemas/cryoEt-path-schema";
import { fetchCtyoETTomogramMetadata } from "../tools/cryoET";
import validateSchema from "../tools/validate-schema";
import { type Request, type Response } from "express";

export default class CryoETController {
  static async getTomographyMetadataFromCryoETId(req: Request, res: Response) {
    const { params } = validateSchema(req, { paramsSchema: idTomogram });

    const metadata = await fetchCtyoETTomogramMetadata(params.idTomogram);

    res.status(200).json(metadata);
  }
}
