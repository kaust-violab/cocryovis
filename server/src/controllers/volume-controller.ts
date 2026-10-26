import { type Request, type Response } from "express";
import Volume from "../models/volume";
import { idProject } from "@cocryovis/schemas/componentSchemas/project-schema";
import {
  idVolume,
  volumeUpdateSchema,
} from "@cocryovis/schemas/componentSchemas/volume-schema";
import validateSchema from "../tools/validate-schema";
import {
  createVolumeReq,
  volumeQuerySchema,
} from "@cocryovis/schemas/volume-path-schema";
import { getSessionUser } from "../middleware/restrict";

export default class VolumeController {
  static getVolume = async (req: Request, res: Response) => {
    const { query, params } = validateSchema(req, {
      querySchema: volumeQuerySchema,
      paramsSchema: idVolume,
    });
    const volume = await Volume.getById(params.idVolume, query);

    res.status(200).json(volume);
  };

  // static getVolumesFromProject = async (req: Request, res: Response) => {
  //     const options = VolumeController.#parseOptionQuery(req);
  //     const volumes = await Volume.getVolumesFromProject(
  //         Number(req.params.idProject),
  //         options
  //     );

  //     res.status(200).json(volumes);
  // }

  static getVolumesFromProjectDeep = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, { paramsSchema: idProject });

    const volumes = await Volume.getVolumesFromProjectDeep(params.idProject);

    res.status(200).json(volumes);
  };

  static createVolume = async (req: Request, res: Response) => {
    const { body, params } = validateSchema(req, {
      bodySchema: createVolumeReq,
      paramsSchema: idProject,
    });

    const volume = await Volume.create(
      body.name,
      body.description,
      getSessionUser(req).id,
      params.idProject
    );

    res.status(201).json(volume);
  };

  // static cloneVolume = async (req: Request, res: Response) => {
  //     const volume = await Volume.clone(
  //         Number(req.params.idVolume),
  //         getSessionUser(req).id,
  //         Number(req.params.idProject)
  //     );
  //     res.status(201).json(volume);
  // }

  static deleteVolume = async (req: Request, res: Response) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolume,
    });

    await Volume.del(params.idVolume);

    res.sendStatus(204);
  };

  static update = async (req: Request, res: Response) => {
    const { params, body } = validateSchema(req, {
      paramsSchema: idVolume,
      bodySchema: volumeUpdateSchema,
    });

    const volume = await Volume.update(params.idVolume, body);
    res.status(201).json(volume);
  };
}
