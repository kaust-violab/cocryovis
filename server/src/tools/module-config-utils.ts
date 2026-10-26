import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const MODULES_DIRECTORY = path.join("..", "modules");
export const MODULES_WRAPPER_DIRECTORY = path.join("src", "modules");
export const MODULES_CONFIG_FILE = "module_config.json";

export type ModuleConfig = Record<string, Record<string, unknown>>;

interface ReadModuleConfigOptions {
  throwOnInvalid?: boolean;
}

const moduleConfigSchema = z.record(
  z.string(),
  z.record(z.string(), z.unknown())
);

export const getModuleConfigPath = (serverRoot: string): string =>
  path.join(serverRoot, MODULES_CONFIG_FILE);

export const readModuleConfig = async (
  serverRoot: string,
  options: ReadModuleConfigOptions = {}
): Promise<ModuleConfig> => {
  const configPath = getModuleConfigPath(serverRoot);

  if (!existsSync(configPath)) {
    return {};
  }

  const content = await fs.readFile(configPath, "utf8");
  const parsed = moduleConfigSchema.safeParse(JSON.parse(content) as unknown);
  if (!parsed.success) {
    if (options.throwOnInvalid ?? false) {
      throw new Error("module_config.json is invalid.");
    }
    return {};
  }

  return parsed.data;
};

export const writeModuleConfig = async (
  serverRoot: string,
  moduleConfig: ModuleConfig
): Promise<void> => {
  const configPath = getModuleConfigPath(serverRoot);
  await fs.writeFile(
    configPath,
    `${JSON.stringify(moduleConfig, null, 2)}\n`,
    "utf8"
  );
};
