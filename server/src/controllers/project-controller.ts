import Project from "../models/project";
import { idProject } from "@cocryovis/schemas/componentSchemas/project-schema";
import {
  projectCreateSchemaReq,
  setAccessSchemaReq,
} from "@cocryovis/schemas/project-path-schema";
import validateSchema from "../tools/validate-schema";
import { type Request, type Response } from "express";
import type { Options } from "../models/project";
import type z from "zod";
import type { volumeQuerySchema } from "@cocryovis/schemas/volume-path-schema";
import { getSessionUser } from "../middleware/restrict";

export default class ProjectController {
  static getAllUserProjects = async (req: Request, res: Response) => {
    const options = ProjectController.#parseOptionQuery(req);
    const projects = await Project.getUserProjects(
      getSessionUser(req).id,
      options
    );
    res.json(projects);
  };

  static getAllUserProjectsDeep = async (req: Request, res: Response) => {
    const projects = await Project.getUserProjectsDeep(getSessionUser(req).id);
    res.json(projects);
  };

  static getProject = async (req: Request, res: Response) => {
    const options = ProjectController.#parseOptionQuery(req);
    const project = await Project.getById(
      Number(req.params.idProject),
      options
    );

    res.json(project);
  };

  static getProjectDeep = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idProject });

    const userId = req.session?.user?.id;
    const project = await Project.getByIdDeep(params.idProject, userId);

    res.json(project);
  };

  static #parseOptionQuery(req: Request): Options {
    const options: Options = {
      volumes: (() => {
        if (!req?.query?.volumes) return false;
        const fullVolume = req.query.volumes === "full";
        const query: z.infer<typeof volumeQuerySchema> = {};
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

  static getAccessInfo = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idProject,
    });

    const accessInfo = await Project.getAccessInfo(params.idProject);

    res.json(accessInfo);
  };

  static setAccess = async (req: Request, res: Response) => {
    const { body, params } = validateSchema(req, {
      bodySchema: setAccessSchemaReq,
      paramsSchema: idProject,
    });

    const accessInfo = await Project.setAccess(params.idProject, body);

    res.json(accessInfo);
  };

  static createProject = async (req: Request, res: Response) => {
    const { body } = validateSchema(req, {
      bodySchema: projectCreateSchemaReq,
    });

    const project = await Project.create(
      body.name,
      body.description,
      getSessionUser(req).id
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
  //         getSessionUser(req).id
  //     );

  //     res.status(201).json(project);
  // }

  static deleteProject = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idProject });

    await Project.del(params.idProject);

    res.sendStatus(204);
  };
}
