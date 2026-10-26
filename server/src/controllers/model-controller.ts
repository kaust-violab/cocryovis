import { type Request, type Response } from "express";
import Model from "../models/model";
import { idProject } from "@cocryovis/schemas/componentSchemas/project-schema";
import {
  createModelSchema,
  getModelQuerySchema,
  idModelAndidProject,
} from "@cocryovis/schemas/models-path-schema";
import validateSchema from "../tools/validate-schema";
import { idModel } from "@cocryovis/schemas/componentSchemas/model-schema";
import { getSessionUser } from "../middleware/restrict";

export default class ModelController {
  static getModel = async (req: Request, res: Response) => {
    const { params, query } = validateSchema(req, {
      paramsSchema: idModel,
      querySchema: getModelQuerySchema,
    });

    const model = await Model.getById(params.idModel, query);

    res.status(200).json(model);
  };

  static getModelsFromProject = async (req: Request, res: Response) => {
    const { params, query } = validateSchema(req, {
      paramsSchema: idProject,
      querySchema: getModelQuerySchema,
    });

    const models = await Model.getModelsFromProject(params.idProject, query);

    res.status(200).json(models);
  };

  static createModel = async (req: Request, res: Response) => {
    const { params, body } = validateSchema(req, {
      paramsSchema: idProject,
      bodySchema: createModelSchema,
    });

    const model = await Model.create(
      body.name,
      body.description,
      getSessionUser(req).id,
      params.idProject
    );

    res.status(201).json(model);
  };

  static cloneModel = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idModelAndidProject,
    });

    const model = await Model.clone(
      params.idModel,
      getSessionUser(req).id,
      params.idProject
    );

    res.status(201).json(model);
  };

  static deleteModel = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idModel,
    });

    await Model.del(params.idModel);

    res.sendStatus(204);
  };
}
