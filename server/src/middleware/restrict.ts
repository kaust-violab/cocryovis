import { ApiError } from "../tools/error-handler";
import Project, { type ProjectDB } from "../models/project";
import {
  VolumeDataFactory,
  VolumeDataType,
} from "../models/volume-data-factory";
import Volume from "../models/volume";
import Model from "../models/model";
import Checkpoint from "../models/checkpoint";
import Result from "../models/result";
import appConfig from "../tools/config";
import type { Request, Response, NextFunction } from "express";
import type { PublicUser } from "../models/user";

export function isActiveSession(req: Request) {
  return req.session?.user !== undefined;
}

/**
 * The logged-in user of a request that passed `restrictApi`.
 */
export function getSessionUser(req: Request): PublicUser {
  const user = req.session.user;
  if (!user) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }
  return user;
}

export function sessionExpired(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- maxAge is relative, expires is the absolute expiry date
  const expires = req.session?.cookie?.expires;
  return expires != null && expires < new Date();
}

export function checkCookieAge(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (sessionExpired(req)) {
    req.session.destroy(() => {
      res.clearCookie(appConfig.cookieName);
    });
  }
  next();
}

export function restrictApi(req: Request, _res: Response, next: NextFunction) {
  if (!isActiveSession(req)) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }
  next();
}

// eslint-disable-next-line @typescript-eslint/require-await -- keep thrown errors as promise rejections
export async function restrictAdminAccess(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!isActiveSession(req) || !req?.session?.user?.admin) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }
  next();
}

async function userHasReadAccessToProject(
  project: ProjectDB,
  userId: number | undefined
) {
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

export async function restrictReadProjectAccess(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const projectId = Number(req.params.idProject);
  const project = await Project.getById(projectId);
  if (!project) {
    throw new ApiError(404, `Project ${projectId.toString()} not found!`);
  }
  if (!(await userHasReadAccessToProject(project, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }
  next();
}

// VOLUME

async function userHasReadAccessToVolume(
  volumeId: number,
  userId: number | undefined
) {
  const volume = await Volume.getById(volumeId, { project: true });
  if (!volume) {
    throw new ApiError(404, `Volume ${volumeId.toString()} not found!`);
  }

  return await userHasReadAccessToProject(volume.project, userId);
}

export async function restrictReadVolumeAccess(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const volumeId = Number(req.params.idVolume);

  if (!(await userHasReadAccessToVolume(volumeId, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}

// VOLUME DATA

async function userHasReadAccessToVolumeData(
  volumeDataId: number,
  volumeDataType: VolumeDataType,
  userId: number | undefined
) {
  const volumeData =
    await VolumeDataFactory.getClass(volumeDataType).getById(volumeDataId);
  if (!volumeData) {
    return false;
  }

  return await userHasReadAccessToVolume(volumeData.volumeId, userId);
}

export async function restrictReadVolumeDataAccess(
  req: Request,
  _res: Response,
  next: NextFunction
) {
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
async function userHasReadAccessToResult(
  resultId: number,
  userId: number | undefined
) {
  const result = await Result.getById(resultId);
  if (!result) {
    throw new ApiError(
      404,
      `Volume ${String((result as ResultDB).volumeId)} not found!`
    );
  }
  return await userHasReadAccessToVolume(result.volumeId, userId);
}

export async function restrictReadResultAccess(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const resultId = Number(req.params.idResult);

  if (!(await userHasReadAccessToResult(resultId, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}

// MODEL

async function userHasReadAccessToModel(
  modelId: number,
  userId: number | undefined
) {
  const model = await Model.getById(modelId, { project: true });
  if (!model) {
    throw new ApiError(404, `Model ${modelId.toString()} not found!`);
  }
  return await userHasReadAccessToProject(model.project, userId);
}

export async function restrictReadModelAccess(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const modelId = Number(req.params.idModel);

  if (!(await userHasReadAccessToModel(modelId, req.session?.user?.id))) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}

// CHECKPOINT

async function userHasReadAccessToCheckpoint(
  checkpointId: number,
  userId: number | undefined
) {
  const checkpoint = await Checkpoint.getById(checkpointId);
  return await userHasReadAccessToModel(checkpoint.modelId, userId);
}

export async function restrictReadCheckpointAccess(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const checkpointId = Number(req.params.idCheckpoint);

  if (
    !(await userHasReadAccessToCheckpoint(checkpointId, req.session?.user?.id))
  ) {
    throw new ApiError(403, `Access to ${req.path} denied!`);
  }

  next();
}
