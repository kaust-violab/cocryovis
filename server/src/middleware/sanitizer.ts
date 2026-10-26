// @ts-check

/**
 * @param {object} obj
 * @returns {object}
 */
export function sanitize(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  if (obj && typeof obj === "object") {
    // eslint-disable-next-line no-unused-vars
    const { passwordHash, passwordSalt, ...rest } = obj;
    return Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [key, sanitize(value)])
    );
  }

  return obj;
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function responseSanitizer(req, res, next) {
  const originalSend = res.json;

  res.json = function (data) {
    const sanitizedData = sanitize(data); // Use the utility function
    return originalSend.call(this, sanitizedData);
  };

  next();
}
