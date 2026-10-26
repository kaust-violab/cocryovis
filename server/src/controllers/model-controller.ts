// @ts-check

import Model from "../models/model";
import { idProject } from "@cocryovis/schemas/componentSchemas/project-schema";
import {
  createModelSchema,
  getModelQuerySchema,
  idModelAndidProject,
} from "@cocryovis/schemas/models-path-schema";
import validateSchema from "../tools/validate-schema";
import { idModel } from "@cocryovis/schemas/componentSchemas/model-schema";

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */
export default class ModelController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getModel = async (req, res) => {
    const { params, query } = validateSchema(req, {
      paramsSchema: idModel,
      querySchema: getModelQuerySchema,
    });

    const model = await Model.getById(params.idModel, query);

    res.status(200).json(model);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getModelsFromProject = async (req, res) => {
    const { params, query } = validateSchema(req, {
      paramsSchema: idProject,
      querySchema: getModelQuerySchema,
    });

    const models = await Model.getModelsFromProject(params.idProject, query);

    res.status(200).json(models);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static createModel = async (req, res) => {
    const { params, body } = validateSchema(req, {
      paramsSchema: idProject,
      bodySchema: createModelSchema,
    });

    const model = await Model.create(
      body.name,
      body.description,
      Number(req.session.user.id),
      params.idProject
    );

    res.status(201).json(model);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static cloneModel = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idModelAndidProject,
    });

    const model = await Model.clone(
      params.idModel,
      req.session.user.id,
      params.idProject
    );

    res.status(201).json(model);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static deleteModel = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idModel,
    });

    await Model.del(params.idModel);

    res.sendStatus(204);
  };
}
