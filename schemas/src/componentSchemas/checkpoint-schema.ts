import z from "zod";
import { idSchema } from "./id-param-schema";

export const checkpointSchema = z.object({
  id: z.number(),
  filePath: z.string().nullable(),
  folderPath: z.string().nullable(),
  creatorId: z.number().nullable(),
});

export const checkpointSchemaArray = z.array(checkpointSchema);

export const idCheckpoint = z.object({
  idCheckpoint: idSchema,
});
