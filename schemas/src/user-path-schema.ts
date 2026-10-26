import { z } from "zod";
import { defaultError, generateErrors } from "./error-path-schema";
import { stringToInt } from "./componentSchemas/string-to-int";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { statusSchema } from "./componentSchemas/status-schema";

const usernameSchema = z.string().min(1, { message: "Username is required." });
const nameSchema = z.string().min(1, { message: "Name is required." });
const emailSchema = z
  .email({
    message: "Please provide a valid email address (e.g., email@example.com).",
  })
  .meta({
    examples: ["email@example.com"],
  });
const passwordSchema = z
  .string()
  .min(6, { message: "Password must be at least 6 characters long." });

export const registerSchema = z.object({
  username: usernameSchema,
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  // .regex(/[A-Z]/, "The password must contain an uppercase letter")
  // .regex(/[a-z]/, "The password must contain a lowercase letter")
  // .regex(/[0-9]/, "The password must contain a number")
  // .regex(/[^A-Za-z0-9]/, "The password must contain a special character"),
});
export const loginSchemaReq = z.object({
  username: z.string(),
  password: z.string(),
});

export const updateUserSchema = z.object({
  username: usernameSchema.optional(),
  name: nameSchema.optional(),
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
});

export const publicUser = z.object({
  id: z.int(),
  username: z.string(),
  name: z.string(),
  email: z.email(),
  admin: z.boolean(),
});

export const statusQuery = z.object({
  pageNumber: stringToInt.optional().meta({
    description:
      "The page number of the results to return (1-based index). If omitted while pageSize is provided, defaults to 1 (first page).",
  }),
  pageSize: stringToInt.optional().meta({
    description:
      "The maximum number of items to return per page. If omitted while page is provided, the default value is 10. If both pageSize and page are omitted, the API returns all available items (no pagination applied).",
  }),
});

export const idUserSchema = z.object({
  id: z.int(),
});

export const usersArray = z.array(publicUser);

export const userPath: ZodOpenApiPathsObject = {
  "/register": {
    post: {
      requestBody: {
        content: {
          "application/json": {
            schema: registerSchema,
          },
        },
      },

      responses: {
        201: {
          content: {
            "application/json": {
              schema: publicUser,
            },
          },
        },
        ...generateErrors([401]),
        ...defaultError,
      },
    },
  },
  "/login": {
    post: {
      requestBody: {
        content: {
          "application/json": {
            schema: loginSchemaReq,
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: publicUser,
            },
          },
        },
        ...generateErrors([401]),
        ...defaultError,
      },
    },
  },
  "/logout": {
    post: {
      summary: "Logs the user out",
      responses: {
        204: {
          description: "User logged out",
        },
        ...defaultError,
      },
    },
  },
  "/getLoggedUserData": {
    get: {
      responses: {
        201: {
          content: {
            "application/json": {
              schema: publicUser,
            },
          },
        },
        ...generateErrors([401]),
        ...defaultError,
      },
    },
  },
  "/users": {
    get: {
      responses: {
        200: {
          description: "List of users",
          content: {
            "application/json": {
              schema: usersArray,
            },
          },
        },
        ...defaultError,
      },
    },
  },
  "/status": {
    get: {
      requestParams: {
        query: statusQuery,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: statusSchema,
            },
          },
        },
        ...defaultError,
      },
    },
  },
  "/user": {
    put: {
      requestBody: {
        content: {
          "application/json": {
            schema: updateUserSchema,
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: publicUser,
            },
          },
        },
        ...defaultError,
        ...generateErrors([400]),
      },
    },
    delete: {
      responses: {
        204: {},
        ...defaultError,
      },
    },
  },
  "/user-admin": {
    get: {
      requestBody: {
        content: {
          "application/json": {
            schema: idUserSchema,
          },
        },
      },
      responses: {
        200: {},
        ...defaultError,
      },
    },
  },
};
