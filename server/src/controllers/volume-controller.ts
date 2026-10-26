// @ts-check

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

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

export default class VolumeController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getVolume = async (req, res) => {
    const { query, params } = validateSchema(req, {
      querySchema: volumeQuerySchema,
      paramsSchema: idVolume,
    });
    const volume = await Volume.getById(params.idVolume, query);

    res.status(200).json(volume);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  // static getVolumesFromProject = async (req, res) => {
  //     const options = VolumeController.#parseOptionQuery(req);
  //     const volumes = await Volume.getVolumesFromProject(
  //         Number(req.params.idProject),
  //         options
  //     );

  //     res.status(200).json(volumes);
  // }

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getVolumesFromProjectDeep = async (req, res) => {
    const { params } = validateSchema(req, { paramsSchema: idProject });

    const volumes = await Volume.getVolumesFromProjectDeep(params.idProject);

    res.status(200).json(volumes);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static createVolume = async (req, res) => {
    const { body, params } = validateSchema(req, {
      bodySchema: createVolumeReq,
      paramsSchema: idProject,
    });

    const volume = await Volume.create(
      body.name,
      body.description,
      req.session.user.id,
      params.idProject
    );

    res.status(201).json(volume);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  // static cloneVolume = async (req, res) => {
  //     const volume = await Volume.clone(
  //         Number(req.params.idVolume),
  //         req.session.user.id,
  //         Number(req.params.idProject)
  //     );
  //     res.status(201).json(volume);
  // }

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static deleteVolume = async (req, res) => {
    const { params } = validateSchema(req, {
      paramsSchema: idVolume,
    });

    await Volume.del(params.idVolume);

    res.sendStatus(204);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static update = async (req, res) => {
    const { params, body } = validateSchema(req, {
      paramsSchema: idVolume,
      bodySchema: volumeUpdateSchema,
    });

    const volume = await Volume.update(params.idVolume, body);
    res.status(201).json(volume);
  };
}
