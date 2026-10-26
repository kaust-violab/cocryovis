import type { Request, Response, NextFunction } from "express";

export function sanitize(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  if (obj && typeof obj === "object") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, passwordSalt, ...rest } = obj as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [key, sanitize(value)])
    );
  }

  return obj;
}

export function responseSanitizer(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  const originalSend = res.json;

  res.json = function (this: Response, data: unknown) {
    const sanitizedData = sanitize(data); // Use the utility function
    return originalSend.call(this, sanitizedData);
  };

  next();
}
