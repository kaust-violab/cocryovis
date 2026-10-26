import z from "zod";
import { idSchema } from "./id-param-schema";
import { checkpointSchema } from "./checkpoint-schema";

export const modelSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  creatorId: z.number().nullable(),
});

export const modelSchemaWithOptionalCheckpoint = modelSchema.extend({
  checkpoints: z.array(checkpointSchema).optional(),
});

export const modelSchemaWithCheckpoint = modelSchema.extend({
  checkpoints: z.array(checkpointSchema),
});

export const idModel = z.object({
  idModel: idSchema,
});
