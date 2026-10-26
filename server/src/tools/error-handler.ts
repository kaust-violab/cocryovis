import { Prisma } from "@prisma/client";
import type { Request, Response, NextFunction } from "express";

export class ApiError extends Error {
  statusCode = 500;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }

  static fromId(instanceId: number, modelName: string): MissingResourceError {
    return new MissingResourceError(
      `The ${modelName} with the ID ${String(instanceId)} does not exist.`
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
  constructor(message: string) {
    super(404, message);
    this.name = "MissingResourceError";
  }

  static override fromId(
    instanceId: number,
    modelName: string
  ): MissingResourceError {
    return new MissingResourceError(
      `The ${modelName} with the ID ${String(instanceId)} does not exist.`
    );
  }
}

export function logErrors(
  err: Error,
  _req: Request,
  _res: Response,
  next: NextFunction
) {
  console.error(err);
  next(err);
}

export function clientErrorHandler(
  error: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) {
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
