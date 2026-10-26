import { ApiError } from "../tools/error-handler";
import appConfig from "../tools/config";
import Project from "../models/project";
import { type Request, type Response } from "express";

export default class DemoController {
  static getDemo = async (_req: Request, res: Response) => {
    const demoProjectIndex = appConfig.demoProjectIndex;
    if (!demoProjectIndex) {
      throw new ApiError(
        500,
        "Demo project index is not set. Please check your configuration."
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- config.json is not validated
    const project = await Project.getByIdDeep(Number(demoProjectIndex));

    res.json(project);
  };
}
