// @ts-check

import { ApiError } from "../tools/error-handler.mjs";
import Project from "../models/project.mjs";
import {
  VolumeDataFactory,
  VolumeDataType,
} from "../models/volume-data-factory.mjs";
import Volume from "../models/volume.mjs";
import Model from "../models/model.mjs";
import Checkpoint from "../models/checkpoint.mjs";
import Result from "../models/result.mjs";
import appConfig from "../tools/config.mjs";

/**
 * @typedef { import("@prisma/client").Project } ProjectDB
 * @typedef { import("@prisma/client").Volume } VolumeDB
 */

/**
 * @param {import("express").Request} req
 */
export function isActiveSession(req) {
  return req.session !== undefined && req.session.user !== undefined;
}

/**
 * @param {import("express").Request} req
 */
export function sessionExpired(req) {
  return (
    req.session?.cookie !== undefined && req.session.cookie.expires < new Date()
  );
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function checkCookieAge(req, res, next) {
  if (sessionExpired(req)) {
    req.session.destroy(() => {
      res.clearCookie(appConfig.cookieName);
    });
  }
  next();
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function restrictApi(req, res, next) {
  if (!isActiveSession(req)) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }
  next();
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function restrictAdminAccess(req, res, next) {
  if (!isActiveSession(req) || !req?.session?.user?.admin) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }
  next();
}

/**
 * @param {import("../models/project.mjs").ProjectDB} project
 * @param {number | undefined} userId
 */
async function userHasReadAccessToProject(project, userId) {
  if (project.publicAccess === 1) {
    return true;
  }
  if (!userId) {
    return false;
  }
  if (project.ownerId === userId) {
    return true;
  }
  const projectAccess = await Project.getUserAccessInfo(project.id, userId);
  if (projectAccess >= 0) {
    return true;
  }
  return false;
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function restrictReadProjectAccess(req, res, next) {
  const projectId = Number(req.params.idProject);
  const project = await Project.getById(projectId);
  if (!project) {
    throw new ApiError(404, `Project ${projectId} not found!`);
  }
  if (!(await userHasReadAccessToProject(project, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }
  next();
}

// VOLUME

/**
 * @param {number} volumeId
 * @param {number | undefined} userId
 */
async function userHasReadAccessToVolume(volumeId, userId) {
  const volume = await Volume.getById(volumeId, { project: true });
  if (!volume) {
    throw new ApiError(404, `Volume ${volumeId} not found!`);
  }

  return await userHasReadAccessToProject(volume.project, userId);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function restrictReadVolumeAccess(req, res, next) {
  const volumeId = Number(req.params.idVolume);

  if (!(await userHasReadAccessToVolume(volumeId, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}

// VOLUME DATA

/**
 * @param {number} volumeDataId
 * @param {VolumeDataType} volumeDataType
 * @param {number | undefined} userId
 */
async function userHasReadAccessToVolumeData(
  volumeDataId,
  volumeDataType,
  userId
) {
  const volumeData =
    await VolumeDataFactory.getClass(volumeDataType).getById(volumeDataId);
  if (!volumeData) {
    return false;
  }

  return await userHasReadAccessToVolume(volumeData.volumeId, userId);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function restrictReadVolumeDataAccess(req, res, next) {
  const volumeDataId = Number(req.params.idVolumeData);
  const volumeDataType = String(req.params.type);

  if (
    !(await userHasReadAccessToVolumeData(
      volumeDataId,
      VolumeDataType.mapName(volumeDataType),
      req.session?.user?.id
    ))
  ) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}

// RESULT
/**
 * @param {number} resultId
 * @param {number | undefined} userId
 */
async function userHasReadAccessToResult(resultId, userId) {
  const result = await Result.getById(resultId);
  if (!result) {
    throw new ApiError(404, `Volume ${result.volumeId} not found!`);
  }
  return await userHasReadAccessToVolume(result.volumeId, userId);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function restrictReadResultAccess(req, res, next) {
  const resultId = Number(req.params.idResult);

  if (!(await userHasReadAccessToResult(resultId, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}

// MODEL

/**
 * @param {number} modelId
 * @param {number | undefined} userId
 */
async function userHasReadAccessToModel(modelId, userId) {
  const model = await Model.getById(modelId, { project: true });
  if (!model) {
    throw new ApiError(404, `Volume ${modelId} not found!`);
  }
  return await userHasReadAccessToProject(model.project, userId);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function restrictReadModelAccess(req, res, next) {
  const modelId = Number(req.params.idModel);

  if (!(await userHasReadAccessToModel(modelId, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}

// CHECKPOINT

/**
 * @param {number} checkpointId
 * @param {number | undefined} userId
 */
async function userHasReadAccessToCheckpoint(checkpointId, userId) {
  const checkpoint = await Checkpoint.getById(checkpointId);
  return await userHasReadAccessToModel(checkpoint.modelId, userId);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function restrictReadCheckpointAccess(req, res, next) {
  const checkpointId = Number(req.params.idCheckpoint);

  if (
    !(await userHasReadAccessToCheckpoint(checkpointId, req.session?.user?.id))
  ) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}
