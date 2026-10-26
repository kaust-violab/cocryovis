// @ts-check

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
import GPUResourcesManager from "../tools/gpu-resources-manager";

/**
 * @import GPUTaskHandler from "../tools/gpu-task-handler"
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

export default class UserController {
  /**
   * @param {Request} req
   * @param {Response} res
   */
  static register = async (req, res) => {
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

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static login = async (req, res) => {
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

  static async #regenerateSession(req) {
    return new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  static async #saveSession(req) {
    return new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static logout = (req, res) => {
    req.session.destroy(function () {
      res.clearCookie(appConfig.cookieName);
      res.sendStatus(204);
    });
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getLoggedUserData = async (req, res) => {
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

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static getAllUsers = async (req, res) => {
    const users = await User.getAllUsers();

    res.json(users);
  };

  /**
   * @param {GPUResourcesManager} gpuResourcesManager
   * @param {Request} req
   * @param {Response} res
   */
  static getStatus = async (gpuResourcesManager, req, res) => {
    const { query } = validateSchema(req, {
      querySchema: statusQuery,
    });
    const taskHistory = await TaskHistory.getFromUser(
      req.session.user.id,
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

  /**
   * @param {GPUResourcesManager} gpuResourcesManager
   * @param {Request} req
   * @param {Response} res
   */
  static getGPUStatus = async (gpuResourcesManager, req, res) => {
    const gpuStatus = {
      totalGpus: gpuResourcesManager.totalGPUs,
      freeGpus: gpuResourcesManager.freeGPUs,
    };

    res.json(gpuStatus);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static updateUser = async (req, res) => {
    const { body } = validateSchema(req, { bodySchema: updateUserSchema });

    const id = req.session.user.id;
    const user = await User.update(id, body);
    const userData = User.toPublic(user);

    await UserController.#regenerateSession(req);
    req.session.user = userData;
    await UserController.#saveSession(req);
    res.json(userData);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static deleteUser = async (req, res) => {
    await User.del(req.session.user.id);

    res.sendStatus(204);
  };

  /**
   * @param {Request} req
   * @param {Response} res
   */
  static adminDeleteUser = async (req, res) => {
    const { body } = validateSchema(req, { bodySchema: idUserSchema });
    if (req.session.user.id === body.id) {
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
