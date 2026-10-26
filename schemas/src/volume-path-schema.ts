import z from "zod";

import { rawVolumeDataSchema } from "./componentSchemas/raw-volume-data-schema";
import { sparseLabelVolumeDataSchema } from "./componentSchemas/sparse-label-volume-data-schema";
import { pseudoLabelVolumeDataSchema } from "./componentSchemas/pseudo-label-volume-data-schema";
import { resultSchemaWithCheckpoint } from "./componentSchemas/result-schema";
import { defaultError } from "./error-path-schema";
import {
  idVolume,
  volumeSchema,
  volumeUpdateSchema,
} from "./componentSchemas/volume-schema";
import { idProject, projectSchema } from "./componentSchemas/project-schema";
import { idSchema } from "./componentSchemas/id-param-schema";
import { stringToBoolean } from "./componentSchemas/string-to-boolean";
import type { ZodOpenApiPathsObject } from "zod-openapi";

export const volumeQuerySchema = z.object({
  rawData: stringToBoolean.optional(),
  sparseVolumes: stringToBoolean.optional(),
  pseudoVolumes: stringToBoolean.optional(),
  results: stringToBoolean.optional(),
  project: stringToBoolean.optional(),
});

export const deepVolumeSchema = volumeSchema.extend({
  rawData: rawVolumeDataSchema.nullable(),
  sparseVolumes: z.array(sparseLabelVolumeDataSchema),
  pseudoVolumes: z.array(pseudoLabelVolumeDataSchema),
  results: z.array(resultSchemaWithCheckpoint),
});

export const volumesDeepSchemaRes = z.array(deepVolumeSchema);

export const createVolumeReq = z.object({
  name: z.string(),
  description: z.string(),
});

export const getVolumeSchema = volumeSchema.extend({
  rawData: rawVolumeDataSchema.nullable(),
  sparseVolumes: z.array(sparseLabelVolumeDataSchema),
  pseudoVolumes: z.array(pseudoLabelVolumeDataSchema),
  results: z.array(resultSchemaWithCheckpoint),
  projects: z.array(projectSchema),
});

export const idProjectAndVolume = z.object({
  idProject: idSchema,
  idVolume: idSchema,
});

export const xyz = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export const annotationsEntry = z.object({
  add: z.boolean(),
  dimensions: xyz,
  kernelSize: xyz,
  positions: z.array(xyz),
  volumeName: z.string(),
});

export const annotationsSchema = z.array(annotationsEntry);

export const volumePath: ZodOpenApiPathsObject = {
  "/project/{idProject}/volumes/deep": {
    get: {
      requestParams: {
        path: idProject,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: volumesDeepSchemaRes,
            },
          },
        },
        ...defaultError,
      },
    },
  },
  "/project/{idProject}/volumes": {
    post: {
      requestParams: {
        path: idProject,
      },
      requestBody: {
        content: {
          "application/json": {
            schema: createVolumeReq,
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: volumeSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },

  "/volume/{idVolume}": {
    get: {
      requestParams: {
        path: idVolume,
        query: volumeQuerySchema,
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: getVolumeSchema,
            },
          },
        },
        ...defaultError,
      },
    },
    put: {
      requestParams: {
        path: idVolume,
      },
      requestBody: {
        content: {
          "application/json": {
            schema: volumeUpdateSchema,
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: volumeSchema,
            },
          },
        },
        ...defaultError,
      },
    },

    delete: {
      requestParams: {
        path: idVolume,
      },
      responses: {
        204: {},
        ...defaultError,
      },
    },
  },
  "/volume/{idVolume}/add-annotations": {
    put: {
      requestParams: {
        path: idVolume,
      },
      requestBody: {
        content: {
          "application/json": {
            schema: annotationsSchema,
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: sparseLabelVolumeDataSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },
};
