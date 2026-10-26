// @ts-check

import { idTomogram } from "@cocryovis/schemas/cryoEt-path-schema";
import { fetchCtyoETTomogramMetadata } from "../tools/cryoET";
import validateSchema from "../tools/validate-schema";

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

export default class CryoETController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static async getTomographyMetadataFromCryoETId(req, res) {
    const { params } = validateSchema(req, { paramsSchema: idTomogram });

    const metadata = await fetchCtyoETTomogramMetadata(params.idTomogram);

    res.status(200).json(metadata);
  }
}
