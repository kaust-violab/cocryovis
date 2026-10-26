import z from "zod";
import { idSchema } from "./id-param-schema";

export const projectSchema = z.object({
  id: z.int(),
  name: z.string(),
  description: z.string(),
  ownerId: z.int(),
  publicAccess: z.int(),
});

export const idProject = z.object({
  idProject: idSchema,
});
