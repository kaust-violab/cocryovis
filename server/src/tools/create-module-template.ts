import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { program } from "commander";
import {
  MODULES_DIRECTORY,
  MODULES_WRAPPER_DIRECTORY,
  readModuleConfig,
  writeModuleConfig,
} from "./module-config-utils";
import Utils from "./utils.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, "..", "..");
const modulesSourceRoot = path.resolve(serverRoot, MODULES_WRAPPER_DIRECTORY);
const modulesRoot = path.resolve(serverRoot, MODULES_DIRECTORY);

interface CliOptions {
  id?: string;
  force: boolean;
}

const toSlug = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const toPascalCase = (value: string): string => {
  const words: string[] = value.match(/[a-zA-Z0-9]+/g) ?? [];
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
};

const writeModuleTemplate = async (
  moduleFilePath: string,
  className: string,
  force: boolean
): Promise<void> => {
  if (existsSync(moduleFilePath) && !force) {
    throw new Error(
      `Module file already exists: ${path.relative(serverRoot, moduleFilePath)}. Use --force to overwrite it.`
    );
  }

  const template = `import { BaseModule } from "./base-module";

export class ${className} extends BaseModule {
  constructor() {
    super();
  }
}
`;

  await fs.mkdir(path.dirname(moduleFilePath), { recursive: true });
  await fs.writeFile(moduleFilePath, template, "utf8");
};

const main = async (): Promise<void> => {
  program
    .name("create-module-template")
    .argument("<module>", "Module id or module name")
    .option("--force", "Overwrite existing module template file", false);

  program.parse(process.argv);

  const input = (program.args[0] ?? "").trim();
  if (!input) {
    throw new Error("Module id is required.");
  }

  const options = program.opts<CliOptions>();
  console.log(options);

  const moduleIdSource = options.id?.trim() || input;
  const moduleId = toPascalCase(moduleIdSource);
  if (!moduleId) {
    throw new Error("Could not derive a valid module id.");
  }

  const slug = toSlug(moduleIdSource);
  if (!slug) {
    throw new Error("Could not derive a valid module file name.");
  }

  const className = `${moduleId}Module`;
  const moduleFileName = `${slug}-module.ts`;
  const moduleFilePath = path.join(modulesSourceRoot, moduleFileName);

  const moduleConfig = await readModuleConfig(serverRoot, {
    throwOnInvalid: true,
  });
  if (moduleConfig[moduleId]) {
    throw new Error(
      `Module id '${moduleId}' already exists in module_config.json.`
    );
  }

  moduleConfig[moduleId] = {
    path: `../modules/${slug}/`,
  };

  await writeModuleTemplate(moduleFilePath, className, options.force);
  await fs.mkdir(path.join(modulesRoot, slug), { recursive: true });

  await writeModuleConfig(serverRoot, moduleConfig);

  console.log(
    `[modules] Created template ${path.relative(serverRoot, moduleFilePath)}`
  );
  console.log(
    `[modules] Updated module_config.json with module id '${moduleId}'.`
  );
};

main().catch((error: unknown) => {
  console.error(`[modules] ${Utils.formatError(error)}`);
  process.exit(1);
});
