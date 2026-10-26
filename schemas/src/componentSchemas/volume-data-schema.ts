import z from "zod";
import { idSchema } from "./id-param-schema";

export const typeSchema = z.enum([
  "RawVolumeData",
  "SparseLabeledVolumeData",
  "PseudoLabeledVolumeData",
]);

export const idVolumeData = z.object({
  idVolumeData: idSchema,
});

export const type = z.object({
  type: typeSchema,
});
