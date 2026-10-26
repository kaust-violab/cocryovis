import z from "zod";
import { checkpointSchema } from "./checkpoint-schema";
import { idSchema } from "./id-param-schema";

export const resultSchema = z.object({
  id: z.int(),
  folderPath: z.string().nullable(),
  rawVolumeChannel: z.int().nullable(),
  logFile: z.string().nullable(),
  checkpointId: z.number(),
  creatorId: z.int().nullable(),
  volumeId: z.int(),
});

export const resultSchemaWithCheckpoint = resultSchema.extend({
  checkpoint: checkpointSchema.nullable(),
});

export const idResult = z.object({
  idResult: idSchema,
});
