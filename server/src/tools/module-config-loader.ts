import fs from "fs";
import path from "path";
import { ApiError } from "./error-handler";

/**
 * Load and validate module configuration from module_config.json
 */

type ModuleConfig = Record<string, unknown>;

class ModuleConfigLoader {
  private moduleConfig: ModuleConfig | null = null;

  /**
   * Load module configuration from file
   */
  loadConfig(configPath = "./module_config.json"): ModuleConfig {
    if (this.moduleConfig) {
      return this.moduleConfig;
    }

    try {
      const absolutePath = path.resolve(configPath);
      if (!fs.existsSync(absolutePath)) {
        throw new ApiError(
          500,
          `Module config file not found at ${absolutePath}`
        );
      }

      const configFile = fs.readFileSync(absolutePath, "utf8");
      const parsedConfig = JSON.parse(configFile) as unknown;

      if (
        typeof parsedConfig !== "object" ||
        parsedConfig === null ||
        Array.isArray(parsedConfig)
      ) {
        throw new ApiError(500, "Module config must be a JSON object");
      }

      this.moduleConfig = parsedConfig as ModuleConfig;

      if (!this.moduleConfig) {
        throw new ApiError(500, "Module config is empty or invalid");
      }

      return this.moduleConfig;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        500,
        `Failed to load module configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get a specific module's configuration
   */
  getModuleConfig(
    moduleName: string,
    configPath = "./module_config.json"
  ): unknown {
    const config = this.loadConfig(configPath);

    if (!config[moduleName]) {
      throw new ApiError(
        500,
        `Configuration not found for module: ${moduleName}`
      );
    }

    return config[moduleName];
  }

  /**
   * Clear cached config (useful for testing)
   */
  clearCache(): void {
    this.moduleConfig = null;
  }
}

export default new ModuleConfigLoader();
