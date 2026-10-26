import z from "zod";
import { idSchema } from "./id-param-schema";
import { physicalUnitSchema } from "./volume-settings-schema";

export const physicalDimensionSchema = z
  .number()
  .positive("Must be a positive number");

export const volumeSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  physicalUnit: physicalUnitSchema,
  physicalSizeX: physicalDimensionSchema,
  physicalSizeY: physicalDimensionSchema,
  physicalSizeZ: physicalDimensionSchema,
  creatorId: z.number().nullable(),
});

export const volumeUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  description: z.string().optional(),
  physicalUnit: physicalUnitSchema.optional(),
  physicalSizeX: physicalDimensionSchema.optional(),
  physicalSizeY: physicalDimensionSchema.optional(),
  physicalSizeZ: physicalDimensionSchema.optional(),
});

export const idVolume = z.object({
  idVolume: idSchema,
});
