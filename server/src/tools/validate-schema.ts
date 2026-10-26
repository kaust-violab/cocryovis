import type z from "zod";
import { fromError } from "zod-validation-error";
import { ApiError } from "./error-handler";
import type { Request } from "express";

type SchemaOutput<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface ValidatedRequest<B, P, Q> {
  body: SchemaOutput<B>;
  params: SchemaOutput<P>;
  query: SchemaOutput<Q>;
}

function replaceStrinInError(input: string): string {
  return input.replace(/\bString\b/g, "Form");
}

export function checkAndThrowValidationError(
  validation: z.ZodSafeParseResult<unknown>
) {
  if (!validation.success) {
    const validationError = fromError(validation.error, {
      maxIssuesInMessage: 1,
      prefix: undefined,
      includePath: false,
    });

    throw new ApiError(400, replaceStrinInError(validationError.toString()));
  }
}

export default function validateSchema<
  B extends z.ZodType | undefined = undefined,
  P extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
>(
  req: Pick<
    Request<unknown, unknown, unknown, unknown>,
    "body" | "params" | "query"
  >,
  {
    bodySchema,
    paramsSchema,
    querySchema,
  }: { bodySchema?: B; paramsSchema?: P; querySchema?: Q } = {}
): ValidatedRequest<B, P, Q> {
  const result = {} as ValidatedRequest<B, P, Q>;
  if (bodySchema !== undefined) {
    const bodyValidation = bodySchema.safeParse(req.body);
    checkAndThrowValidationError(bodyValidation);
    result.body = bodyValidation.data as SchemaOutput<B>;
  }

  if (paramsSchema !== undefined) {
    const paramsValidation = paramsSchema.safeParse(req.params);
    checkAndThrowValidationError(paramsValidation);
    result.params = paramsValidation.data as SchemaOutput<P>;
  }

  if (querySchema !== undefined) {
    const queryValidation = querySchema.safeParse(req.query);
    checkAndThrowValidationError(queryValidation);
    result.query = queryValidation.data as SchemaOutput<Q>;
  }
  return result;
}
