import User from "../models/user";
import { ApiError } from "../tools/error-handler";
import TaskHistory from "../models/task-history";
import appConfig from "../tools/config";
import validateSchema from "../tools/validate-schema";
import {
  idUserSchema,
  loginSchemaReq,
  registerSchema,
  statusQuery,
  updateUserSchema,
} from "@cocryovis/schemas/user-path-schema";
import type GPUResourcesManager from "../tools/gpu-resources-manager";
import { type Request, type Response } from "express";
import { getSessionUser } from "../middleware/restrict";

export default class UserController {
  static register = async (req: Request, res: Response) => {
    const { body } = validateSchema(req, { bodySchema: registerSchema });

    const user = await User.create(
      body.username,
      body.password,
      body.name,
      body.email
    );

    const userData = User.toPublic(user);

    await UserController.#regenerateSession(req);
    req.session.user = userData;
    await UserController.#saveSession(req);

    res.status(201).json(userData);
  };

  static login = async (req: Request, res: Response) => {
    const { body } = validateSchema(req, { bodySchema: loginSchemaReq });

    try {
      const user = await User.authenticate(body.username, body.password);

      const userData = User.toPublic(user);

      await UserController.#regenerateSession(req);
      req.session.user = userData;
      await UserController.#saveSession(req);
      console.log("User " + body.username + " just logged in.");

      res.json(userData);
    } catch {
      throw new ApiError(401, "Authentication Failed");
    }
  };

  static async #regenerateSession(req: Request): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      req.session.regenerate((err?: Error) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  static async #saveSession(req: Request): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      req.session.save((err?: Error) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  static logout = (req: Request, res: Response) => {
    req.session.destroy(function () {
      res.clearCookie(appConfig.cookieName);
      res.sendStatus(204);
    });
  };

  // eslint-disable-next-line @typescript-eslint/require-await -- keep thrown errors as promise rejections
  static getLoggedUserData = async (req: Request, res: Response) => {
    try {
      if (req.session != null) {
        res.json(req.session.user);
      } else {
        res.sendStatus(401);
      }
    } catch {
      res.sendStatus(401);
    }
  };

  static getAllUsers = async (_req: Request, res: Response) => {
    const users = await User.getAllUsers();

    res.json(users);
  };

  static getStatus = async (
    gpuResourcesManager: GPUResourcesManager,
    req: Request,
    res: Response
  ) => {
    const { query } = validateSchema(req, {
      querySchema: statusQuery,
    });
    const taskHistory = await TaskHistory.getFromUser(
      getSessionUser(req).id,
      query.pageNumber,
      query.pageSize
    );
    const cpuTaskQueue = await TaskHistory.getCPUTaskQueue();
    const gpuTaskQueue = await TaskHistory.getGPUTaskQueue();
    const gpuStatus = {
      totalGpus: gpuResourcesManager.totalGPUs,
      freeGpus: gpuResourcesManager.freeGPUs,
    };

    res.json({
      taskHistory: taskHistory,
      gpuStatus: gpuStatus,
      cpuTaskQueue: cpuTaskQueue,
      gpuTaskQueue: gpuTaskQueue,
    });
  };

  // eslint-disable-next-line @typescript-eslint/require-await -- keep thrown errors as promise rejections
  static getGPUStatus = async (
    gpuResourcesManager: GPUResourcesManager,
    _req: Request,
    res: Response
  ) => {
    const gpuStatus = {
      totalGpus: gpuResourcesManager.totalGPUs,
      freeGpus: gpuResourcesManager.freeGPUs,
    };

    res.json(gpuStatus);
  };

  static updateUser = async (req: Request, res: Response) => {
    const { body } = validateSchema(req, { bodySchema: updateUserSchema });

    const id = getSessionUser(req).id;
    const user = await User.update(id, body);
    const userData = User.toPublic(user);

    await UserController.#regenerateSession(req);
    req.session.user = userData;
    await UserController.#saveSession(req);
    res.json(userData);
  };

  static deleteUser = async (req: Request, res: Response) => {
    await User.del(getSessionUser(req).id);

    res.sendStatus(204);
  };

  static adminDeleteUser = async (req: Request, res: Response) => {
    const { body } = validateSchema(req, { bodySchema: idUserSchema });
    if (getSessionUser(req).id === body.id) {
      throw new ApiError(
        400,
        "This action cannot be used to delete your own account."
      );
    }
    const user = await User.getById(body.id);
    if (user.admin) {
      throw new ApiError(
        400,
        "This action cannot be used to delete an administrator account."
      );
    }
    await User.del(body.id);

    res.sendStatus(204);
  };
}
