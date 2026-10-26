import type { Request, Response, NextFunction } from "express";

export function delay(ms = 1000) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    setTimeout(() => {
      next();
    }, ms);
  };
}
