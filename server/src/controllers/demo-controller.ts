// @ts-check

import { ApiError } from "../tools/error-handler";
import appConfig from "../tools/config";
import Project from "../models/project";

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

export default class DemoController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getDemo = async (req, res) => {
    const demoProjectIndex = appConfig.demoProjectIndex;
    if (!demoProjectIndex) {
      throw new ApiError(
        500,
        "Demo project index is not set. Please check your configuration."
      );
    }
    const project = await Project.getByIdDeep(Number(demoProjectIndex));

    res.json(project);
  };
}
