// @ts-check

import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js, jsdoc },
    extends: ["js/recommended", jsdoc.configs["flat/recommended-error"]],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: true,
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      "jsdoc/no-undefined-types": 1,
      "jsdoc/check-indentation": 0,
      "jsdoc/check-line-alignment": 1,
      "jsdoc/check-template-names": 0,
      "jsdoc/check-syntax": 1,
      "jsdoc/no-bad-blocks": 1,
      "jsdoc/no-blank-block-descriptions": 1,
      "jsdoc/no-defaults": 1,
      "jsdoc/require-asterisk-prefix": 1,
      "jsdoc/require-jsdoc": 0, // Recommended
      "jsdoc/require-param-description": 0, // Recommended
      "jsdoc/require-property-description": 0, // Recommended
      "jsdoc/require-returns": 0, // Recommended
      "jsdoc/require-returns-check": 0, // Recommended
      "jsdoc/require-returns-description": 0, // Recommended
      "jsdoc/require-template": 1,
      "jsdoc/require-yields": 0, // Recommended
      "jsdoc/valid-types": 0, // Recommended
      "jsdoc/reject-any-type": 0,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: {
          allowDefaultProject: ["prisma/seed.ts", "prisma/seeds/*.ts"],
        },
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-useless-default-assignment": "off",
      // Conflicts with no-non-null-assertion; prefer explicit `as` casts.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
    },
  },
  globalIgnores([
    "client/*",
    "data/*",
    "demo/*",
    "logs/*",
    "modules/*",
    "node_modules/*",
    "sessions/*",
    "database/*",
    "dist/*",
    ".venv",
    "transfer-functions/*",
    "*.json",
    "*.log",
    "*.sh",
    "*.yaml",
    "*.yml",
    "*.md",
    "eslint.config.js",
    "tsup.config.ts",
    "prisma.config.ts",

    "!package.json",
    "!tsconfig*.json",
    "!nodemon.json",
    "!jsconfig.json",
    "!config.json",
    ".config/*",
  ]),
]);
