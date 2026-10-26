// @ts-check

import z from "zod";
import { fromError } from "zod-validation-error";
import { ApiError } from "./error-handler";

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

/**
 * @param {string} input
 * @returns {string}
 */
function replaceStrinInError(input) {
  return input.replace(/\bString\b/g, "Form");
}

/**
 * @param {z.ZodSafeParseResult<any>} validation
 */
export function checkAndThrowValidationError(validation) {
  if (!validation.success) {
    const validationError = fromError(validation.error, {
      maxIssuesInMessage: 1,
      prefix: undefined,
      includePath: false,
    });

    throw new ApiError(400, replaceStrinInError(validationError.toString()));
  }
}

/**
 * @template {z.ZodTypeAny} [B=z.ZodTypeAny]
 * @template {z.ZodTypeAny} [P=z.ZodTypeAny]
 * @template {z.ZodTypeAny} [Q=z.ZodTypeAny]
 * @param {Request} req
 * @param {{ bodySchema?: B, paramsSchema?: P, querySchema?: Q }} [schemas]
 * @returns {{
 *   body?: z.output<B>,
 *   params?: z.output<P>,
 *   query?: z.output<Q>
 * }}
 */
export default function validateSchema(
  req,
  { bodySchema, paramsSchema, querySchema } = {}
) {
  const result = {};
  if (bodySchema !== undefined) {
    const bodyValidation = bodySchema.safeParse(req.body);
    checkAndThrowValidationError(bodyValidation);
    result.body = bodyValidation.data;
  }

  if (paramsSchema !== undefined) {
    const paramsValidation = paramsSchema.safeParse(req.params);
    checkAndThrowValidationError(paramsValidation);
    result.params = paramsValidation.data;
  }

  if (querySchema !== undefined) {
    const queryValidation = querySchema.safeParse(req.query);
    checkAndThrowValidationError(queryValidation);
    result.query = queryValidation.data;
  }
  return result;
}
