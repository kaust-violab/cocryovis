// @ts-check

import { Prisma } from "@prisma/client";

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 * @typedef { import("express").NextFunction } NextFunction
 */
export class ApiError extends Error {
  /** @type {number} */
  statusCode = 500;

  /**
   * @param {number} statusCode
   * @param {string} message
   */
  constructor(statusCode, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }

  /**
   * @param {number} instanceId
   * @param {string} modelName
   * @returns {MissingResourceError}
   */
  static fromId(instanceId, modelName) {
    return new MissingResourceError(
      `The ${modelName} with the ID ${instanceId} does not exist.`
    );
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
    };
  }
}

export class MissingResourceError extends ApiError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(404, message);
    this.name = "MissingResourceError";
  }

  /**
   * @param {number} instanceId
   * @param {string} modelName
   * @returns {MissingResourceError}
   */
  static fromId(instanceId, modelName) {
    return new MissingResourceError(
      `The ${modelName} with the ID ${instanceId} does not exist.`
    );
  }
}

/**
 * @param {Error} err
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 */
export function logErrors(err, req, res, next) {
  console.error(err);
  next(err);
}

/**
 * @param {Error} error
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 */
export function clientErrorHandler(error, req, res, next) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    res.status(404).json({ name: error.name, message: error.message });
  } else if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      name: error.name,
      message: error.message,
    });
  } else {
    res.status(500).json({ name: error.name, message: error.message });
  }
  next();
}
