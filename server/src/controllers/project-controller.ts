// @ts-check

import Project from "../models/project";
import { idProject } from "@cocryovis/schemas/componentSchemas/project-schema";
import {
  projectCreateSchemaReq,
  setAccessSchemaReq,
} from "@cocryovis/schemas/project-path-schema";
import validateSchema from "../tools/validate-schema";

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */
export default class ProjectController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getAllUserProjects = async (req, res) => {
    const options = ProjectController.#parseOptionQuery(req);
    const projects = await Project.getUserProjects(
      req.session.user.id,
      options
    );
    res.json(projects);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getAllUserProjectsDeep = async (req, res) => {
    const projects = await Project.getUserProjectsDeep(req.session.user.id);
    res.json(projects);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getProject = async (req, res) => {
    const options = ProjectController.#parseOptionQuery(req);
    const project = await Project.getById(
      Number(req.params.idProject),
      options
    );

    res.json(project);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getProjectDeep = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idProject });

    const userId = req.session?.user?.id;
    const project = await Project.getByIdDeep(Number(params.idProject), userId);

    res.json(project);
  };

  /**
   * @param {Request} req
   * @returns {import("../models/project").Options}
   */
  static #parseOptionQuery(req) {
    const options = {
      volumes: (() => {
        if (!req?.query?.volumes) return false;
        const fullVolume = req.query.volumes === "full";
        const query = {};
        if (req.query.rawData || fullVolume) {
          query.rawData = true;
        }
        if (req.query.sparseVolumes || fullVolume) {
          query.sparseVolumes = true;
        }
        if (req.query.pseudoVolumes || fullVolume) {
          query.pseudoVolumes = true;
        }
        if (req.query.results || fullVolume) {
          query.results = true;
        }

        return Object.keys(query).length > 0 ? { include: query } : true;
      })(),
      models: (() => {
        if (!req?.query?.models) return false;
        return req.query.checkpoints || req.query.models === "full"
          ? { include: { checkpoints: true } }
          : true;
      })(),
      owner: !!req?.query?.owner,
    };

    return options;
  }

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getAccessInfo = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idProject,
    });

    const accessInfo = await Project.getAccessInfo(params.idProject);

    res.json(accessInfo);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static setAccess = async (req, res) => {
    const { body, params } = validateSchema(req, {
      bodySchema: setAccessSchemaReq,
      paramsSchema: idProject,
    });

    const accessInfo = await Project.setAccess(params.idProject, body);

    res.json(accessInfo);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static createProject = async (req, res) => {
    const { body } = validateSchema(req, {
      bodySchema: projectCreateSchemaReq,
    });

    const project = await Project.create(
      body.name,
      body.description,
      req.session.user.id
    );

    res.status(201).json(project);
  };

  // /**
  //  * @param {Request} req
  //  * @param {Response} res
  //  */
  // static async deepCloneProject(req, res) {
  //     const project = await Project.deepClone(
  //         Number(req.params.idProject),
  //         req.session.user.id
  //     );

  //     res.status(201).json(project);
  // }

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static deleteProject = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idProject });

    await Project.del(params.idProject);

    res.sendStatus(204);
  };
}
