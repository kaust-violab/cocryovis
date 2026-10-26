import z from "zod";
import { defaultError } from "./error-path-schema";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { tiltSeriesOptions } from "./componentSchemas/tilt-series-schema";
import { idSchema } from "./componentSchemas/id-param-schema";

export const idTomogram = z.object({
  idTomogram: idSchema,
});

export const tomogramSchema = z.object({
  id: z.int(),
  alignment_id: z.int(),
  deposition_id: z.int(),
  run_id: z.int(),
  tomogram_voxel_spacing_id: z.int(),
  name: z.string(),
  size_x: z.int(),
  size_y: z.int(),
  size_z: z.int(),
  voxel_spacing: z.number(),
  fiducial_alignment_status: z.string(),
  reconstruction_method: z.string(),
  processing: z.string(),
  tomogram_version: z.number(),
  processing_software: z.string(),
  reconstruction_software: z.string(),
  is_portal_standard: z.boolean(),
  is_author_submitted: z.boolean(),
  is_visualization_default: z.boolean(),
  s3_omezarr_dir: z.string(),
  https_omezarr_dir: z.string(),
  file_size_omezarr: z.number(),
  s3_mrc_file: z.string(),
  https_mrc_file: z.string(),
  file_size_mrc: z.number(),
  scale_0_dimensions: z.string(),
  scale_1_dimensions: z.string(),
  scale_2_dimensions: z.string(),
  ctf_corrected: z.boolean(),
  offset_x: z.int(),
  offset_y: z.int(),
  offset_z: z.int(),
  key_photo_url: z.string(),
  key_photo_thumbnail_url: z.string(),
  neuroglancer_config: z.string(),
  publications: z.string(),
  related_database_entries: z.string(),
  release_date: z.string(),
  last_modified_date: z.string(),
});

export const data = z.object({
  volumeId: z.int(),
  options: tiltSeriesOptions,
});

export const tiltSeries = z.object({
  tiltSeries: z.file(),
  data,
});

export const tiltSeriesValidation = tiltSeries.omit({
  tiltSeries: true,
});

export const cryoEtPath: ZodOpenApiPathsObject = {
  "/tilt-series-reconstruction": {
    post: {
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: tiltSeries,
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ id: z.number() }),
            },
          },
        },
        ...defaultError,
      },
    },
  },
  "/cryoet/:idTomogram/": {
    get: {
      requestParams: {
        path: idTomogram,
      },
      responses: {
        200: {
          content: {
            "application/zip": {
              schema: tomogramSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },
};
