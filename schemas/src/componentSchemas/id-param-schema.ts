/// <reference types="zod-openapi" />
import { stringToInt } from "./string-to-int";

export const idSchema = stringToInt.meta({
  param: { examples: { id: { value: "1" } } },
});
