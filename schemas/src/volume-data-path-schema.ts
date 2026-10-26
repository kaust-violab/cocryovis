import z from "zod";
import { idSchema } from "./componentSchemas/id-param-schema";
import { typeSchema } from "./componentSchemas/volume-data-schema";
import { defaultError } from "./error-path-schema";
import {
  sparseLabelVolumeDataSchema,
  sparseLabelVolumeDataUpdateSchema,
} from "./componentSchemas/sparse-label-volume-data-schema";
import {
  pseudoLabelVolumeDataSchema,
  pseudoLabelVolumeDataUpdateSchema,
} from "./componentSchemas/pseudo-label-volume-data-schema";
import {
  rawVolumeDataSchema,
  rawVolumeDataUpdateSchema,
} from "./componentSchemas/raw-volume-data-schema";
import { fileSchema, singleFileSchema } from "./componentSchemas/file-schema";
import {
  volumeDescriptorSettingsSchema,
  volumeSettings,
} from "./componentSchemas/volume-settings-schema";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { tiltSeriesOptions } from "./componentSchemas/tilt-series-schema";

export const volumeData = z.union([
  sparseLabelVolumeDataSchema,
  pseudoLabelVolumeDataSchema,
  rawVolumeDataSchema,
]);

export const volumeDataUpdate = z.union([
  sparseLabelVolumeDataUpdateSchema,
  pseudoLabelVolumeDataUpdateSchema,
  rawVolumeDataUpdateSchema,
]);

// export const fileType = z.object({ type: z.enum(["mrc", "raw"]) });

// export const url = z.url({
//   protocol: /^https?$/,
// });

export const fileTypeSchema = z.enum(["mrc", "raw"]);

export const fromUrlSchema = z
  .object({
    fileType: fileTypeSchema,
    url: z.url({
      protocol: /^https?$/,
    }),
    volumeSettings: volumeDescriptorSettingsSchema.optional(),
  })
  .refine((f) => f.fileType !== "raw" || f.volumeSettings, {
    message: "Raw files require volume settings.",
  });

export const updateAnnotationsSchema = z.object({
  rawFile: fileSchema,
});

export const idVolumeAndType = z.object({
  idVolume: idSchema,
  type: typeSchema,
});

export const idVolumeDataAndType = z.object({
  idVolumeData: idSchema,
  type: typeSchema,
});

export const idVolumeVolumeDataTypeParams = z.object({
  idVolumeData: idSchema,
  type: typeSchema,
  idVolume: idSchema,
});
export const createFromFilesSchema = z.object({
  volumeSettings,
  rawFile: fileSchema,
  reconstructionParameters: tiltSeriesOptions.optional(),
});

export const volumeDataPath: ZodOpenApiPathsObject = {
  "/volumeData/{type}/{idVolumeData}": {
    get: {
      requestParams: {
        path: idVolumeDataAndType,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: volumeData,
            },
          },
        },
        ...defaultError,
      },
    },
    put: {
      requestParams: {
        path: idVolumeDataAndType,
      },
      requestBody: {
        content: {
          "application/json": {
            schema: volumeDataUpdate,
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: volumeData,
            },
          },
        },
        ...defaultError,
      },
    },
    delete: {
      requestParams: {
        path: idVolumeDataAndType,
      },
      responses: {
        204: {},
        ...defaultError,
      },
    },
  },
  "/volumeData/{type}/{idVolumeData}/data": {
    get: {
      requestParams: {
        path: idVolumeDataAndType,
      },

      responses: {
        200: {
          content: {
            "application/octet-stream": {},
          },
        },
        ...defaultError,
      },
    },
  },
  "/volumeData/{type}/{idVolumeData}/visualization-data": {
    get: {
      requestParams: {
        path: idVolumeDataAndType,
      },
      responses: {
        200: {
          content: {
            "application/octet-stream": {},
          },
        },
        ...defaultError,
      },
    },
  },
  "/volume/{idVolume}/volumeData/:type/from-files": {
    post: {
      requestParams: {
        path: idVolumeAndType,
      },

      requestBody: {
        content: {
          "multipart/form-data": {
            schema: createFromFilesSchema,
          },
        },
      },

      responses: {
        201: {
          content: {
            "application/json": {
              schema: volumeData,
            },
          },
        },
        ...defaultError,
      },
    },
  },
  "/volume/{idVolume}/volumeData/{type}/from-mrc-file": {
    post: {
      requestParams: {
        path: idVolumeAndType,
      },
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: singleFileSchema,
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: rawVolumeDataSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },
  "/volume/{idVolume}/volumeData/{type}/from-url": {
    post: {
      requestParams: {
        path: idVolumeAndType,
      },
      requestBody: {
        content: {
          "application/json": {
            schema: fromUrlSchema,
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": {
              schema: rawVolumeDataSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },
  "/volume/{idVolume}/volumeData/{type}/{idVolumeData}/update-annotations": {
    put: {
      requestParams: {
        path: idVolumeVolumeDataTypeParams,
      },
      requestBody: {
        content: {
          "application/json": {
            schema: updateAnnotationsSchema,
          },
        },
      },
      responses: {
        200: {
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
  "/volumeData/{type}/{idVolumeData}/download-full": {
    get: {
      requestParams: {
        path: idVolumeDataAndType,
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
      },
    },
  },
  "/volumeData/{type}/{idVolumeData}/download-raw-file": {
    get: {
      requestParams: {
        path: idVolumeDataAndType,
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
      },
    },
  },
  "/volumeData/{type}/{idVolumeData/download-settings-file": {
    get: {
      requestParams: {
        path: idVolumeDataAndType,
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
      },
    },
  },
  "/volumeData/{type}/{idVolumeData/download-mrc-file": {
    get: {
      requestParams: {
        path: idVolumeDataAndType,
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
      },
    },
  },
};
