//@ts-check

/**
 * @param {number} [ms]
 */
export function delay(ms = 1000) {
  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {import("express").NextFunction} next
   */
  return (req, res, next) => {
    setTimeout(() => {
      next();
    }, ms);
  };
}
