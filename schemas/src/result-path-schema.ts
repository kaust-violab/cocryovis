import z from "zod";
import { idResult, resultSchema } from "./componentSchemas/result-schema";
import { defaultError, generateErrors } from "./error-path-schema";
import { idVolume } from "./componentSchemas/volume-schema";
import { checkpointSchema } from "./componentSchemas/checkpoint-schema";
import {
  multipleFileSchema,
  singleFileSchema,
} from "./componentSchemas/file-schema";
import { idSchema } from "./componentSchemas/id-param-schema";
import type { ZodOpenApiPathsObject } from "zod-openapi";

export const idVolumeAndIdResultParams = z.object({
  idVolume: idSchema,
  idResult: idSchema,
});

export const resultFilesSchema = z.object({
  id: z.number(),
  name: z.string(),
  rawFileName: z.string(),
  settingsFileName: z.string(),
  index: z.number(),
  resultId: z.number(),
});

export const getResultSchema = z.array(
  resultSchema.extend({
    checkpoints: checkpointSchema,
  })
);

export const volumeDescriptors = z.object({
  name: z.string(),
  index: z.number(),
});

export const createFromFilesSchema = z.object({
  idCheckpoint: z.int(),
  volumeDescriptors: z.array(volumeDescriptors),
  files: multipleFileSchema,
});

export const resultPath: ZodOpenApiPathsObject = {
  "/result/{idResult}": {
    get: {
      requestParams: {
        path: idResult,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: resultSchema,
            },
          },
        },
        ...defaultError,
      },
    },
    delete: {
      requestParams: {
        path: idResult,
      },
      responses: {
        204: {},
        ...defaultError,
      },
    },
  },
  // "/result/{idResult}/details": {
  //     get: {
  //         requestParams: {
  //             path: idResult,
  //         },
  //         responses: {
  //             200: {
  //                 content: {
  //                     "application/json": {
  //                         schema: resultSchema,
  //                     },
  //                 },
  //             },
  //             ...defaultError,
  //         },
  //     },
  // },
  "/volume/{idVolume}/results": {
    get: {
      requestParams: {
        path: idVolume,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: getResultSchema,
            },
          },
        },
        ...defaultError,
      },
    },

    post: {
      requestParams: {
        path: idVolume,
      },
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: createFromFilesSchema,
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: resultFilesSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },

  "/result/{idResult}/data": {
    get: {
      requestParams: {
        path: idResult,
      },
      responses: {
        200: {
          content: {
            "application/zip": {
              schema: singleFileSchema,
            },
          },
        },
        ...defaultError,
        ...generateErrors([400]),
      },
    },
  },
};
