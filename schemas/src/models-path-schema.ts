import z from "zod";
import { defaultError } from "./error-path-schema";
import { idProject, projectSchema } from "./componentSchemas/project-schema";
import { idModel, modelSchema } from "./componentSchemas/model-schema";
import { checkpointSchema } from "./componentSchemas/checkpoint-schema";
import { typeSchema } from "./componentSchemas/volume-data-schema";
import { idSchema } from "./componentSchemas/id-param-schema";
import { stringToBoolean } from "./componentSchemas/string-to-boolean";
import type { ZodOpenApiPathsObject } from "zod-openapi";

export const getModelQuerySchema = z.object({
  checkpoints: stringToBoolean.optional(),
  project: stringToBoolean.optional(),
});

export const getModelsSchema = z.array(
  modelSchema.extend({
    checkpoints: z.array(checkpointSchema).optional(),
    projects: z.array(projectSchema).optional(),
  })
);

export const createModelSchema = z.object({
  name: z.string().min(1, "Model name is required"),
  description: z.string(),
});

export const idModelAndTypeSchema = z.object({
  idModel: idSchema,
  type: typeSchema,
});

export const idModelAndidProject = z.object({
  idModel: idSchema,
  idProject: idSchema,
});

export const modelsPath: ZodOpenApiPathsObject = {
  "/project/{idProject}/models": {
    get: {
      requestParams: {
        path: idProject,
        query: getModelQuerySchema,
      },

      responses: {
        200: {
          content: {
            "application/json": {
              schema: getModelsSchema,
            },
          },
        },
        ...defaultError,
      },
    },

    post: {
      requestParams: {
        path: idProject,
      },
      requestBody: {
        content: {
          "application/json": {
            schema: createModelSchema,
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: modelSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },
  // "/project/{idProject}/model/{idModel}/clone": {
  //     post: {
  //         requestParams: {
  //             path: idModelAndTypeSchema,
  //         },

  //         responses: {
  //             201: {
  //                 content: {
  //                     "application/json": {
  //                         schema: createModelSchema,
  //                     },
  //                 },
  //             },
  //             ...defaultError,
  //         },
  //     },
  // },
  "/model/{idModel}": {
    get: {
      requestParams: {
        path: idModel,
        query: getModelQuerySchema,
      },

      responses: {
        201: {
          content: {
            "application/json": {
              schema: getModelsSchema,
            },
          },
        },
        ...defaultError,
      },
    },
    delete: {
      requestParams: {
        path: idModel,
      },

      responses: {
        204: {},
        ...defaultError,
      },
    },
  },
};
