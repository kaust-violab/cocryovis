import path from "path";
import { z } from "zod";
import Utils from "../tools/utils.mjs";
import { BaseModule } from "./base-module";
import type { ModuleInstallContext } from "./base-module";
import { ApiError } from "../tools/error-handler.mjs";
import type LogFile from "../tools/log-manager.mjs";
import type { tiltSeriesOptions } from "@cocryovis/schemas/componentSchemas/tilt-series-schema";

export const proximalCryoETConfigSchema = z.object({
  path: z.string().min(1),
});

const proximalCryoETInstallConfigSchema = z.object({
  cudaArchitectures: z.string().min(1).optional(),
  gccVersion: z.string().min(1).optional(),
  cudaHome: z.string().min(1).optional(),
});

/** GCC versions compatible with the CUDA host compiler, in order of preference. */
const SUPPORTED_GCC_VERSIONS = ["12", "11", "13"];

/**
 * Finds the first GCC version for which both gcc-N and g++-N exist on PATH.
 */
function findGccToolchain(
  versions: readonly string[],
  existsSync: (targetPath: string) => boolean
): { cc: string; cxx: string } | undefined {
  const searchDirs = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const findOnPath = (binary: string) =>
    searchDirs
      .map((dir) => path.join(dir, binary))
      .find((candidate) => existsSync(candidate));

  for (const version of versions) {
    const cc = findOnPath(`gcc-${version}`);
    const cxx = findOnPath(`g++-${version}`);
    if (cc && cxx) {
      return { cc, cxx };
    }
  }

  return undefined;
}

export type ProximalCryoETConfig = z.infer<typeof proximalCryoETConfigSchema>;

/**
 * Proximal_CryoET Module - Wraps CUDA_PROXIMAL_SART executable for 3D reconstruction
 */
export class ProximalCryoETModule extends BaseModule {
  protected proximalConfig: ProximalCryoETConfig;

  static readonly executablePath =
    "CUDA_PROXIMAL_SART/build/CUDA_PROXIMAL_SART";

  constructor(config: ProximalCryoETConfig) {
    super();
    this.proximalConfig = config;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    const executablePath = path.join(
      this.proximalConfig.path,
      ProximalCryoETModule.executablePath
    );
    this.validateFileExists(executablePath);
  }

  static override async installModule(
    moduleId: string,
    {
      modulesRoot,
      runCommand,
      removePath,
      existsSync,
      getEnvValue,
      getModuleInstallConfig,
    }: ModuleInstallContext
  ): Promise<void> {
    const config = getModuleInstallConfig(
      moduleId,
      proximalCryoETInstallConfigSchema
    );
    const proximalPath = path.join(
      modulesRoot,
      "Proximal_CryoET",
      "CUDA_PROXIMAL_SART"
    );
    const cudaArchitectures =
      getEnvValue([
        "PROXIMAL_CRYOET_CUDA_ARCHITECTURES",
        "CUDA_ARCHITECTURES",
      ]) ??
      config.cudaArchitectures ??
      "native";

    console.log(
      `Proximal_CryoET: Installing module at ${proximalPath} with CUDA architectures: ${cudaArchitectures}`
    );

    if (!existsSync(path.join(proximalPath, "CMakeLists.txt"))) {
      throw new Error(
        `Proximal_CryoET: Sources not found at ${proximalPath}. Run "git submodule update --init server/modules/Proximal_CryoET".`
      );
    }

    await removePath(path.join(proximalPath, "build"), {
      recursive: true,
      force: true,
    });

    const requestedGccVersion =
      getEnvValue(["PROXIMAL_CRYOET_GCC_VERSION"]) ?? config.gccVersion;
    const gccVersions = requestedGccVersion
      ? [requestedGccVersion]
      : SUPPORTED_GCC_VERSIONS;
    const toolchain = findGccToolchain(gccVersions, existsSync);
    if (!toolchain) {
      throw new Error(
        `Proximal_CryoET: No supported GCC toolchain found on PATH (tried gcc-/g++- ${gccVersions.join(", ")}).`
      );
    }

    const cudaHome =
      getEnvValue(["PROXIMAL_CRYOET_CUDA_HOME", "CUDA_HOME"]) ??
      config.cudaHome;
    const nvccPath = path.join(cudaHome, "bin", "nvcc");
    if (!existsSync(nvccPath)) {
      throw new Error(
        `Proximal_CryoET: nvcc not found at ${nvccPath}. Set PROXIMAL_CRYOET_CUDA_HOME/CUDA_HOME or ProximalCryoET.cudaHome in module_config.json.`
      );
    }

    const compilerEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CC: toolchain.cc,
      CXX: toolchain.cxx,
      CUDACXX: nvccPath,
      CUDAHOSTCXX: toolchain.cxx,
    };

    await runCommand(
      "cmake",
      [
        "-S",
        "./",
        "-B",
        "./build",
        `-DCUDA_ARCHITECTURES=${cudaArchitectures}`,
      ],
      {
        cwd: proximalPath,
        env: compilerEnv,
      }
    );

    await runCommand("make", [], {
      cwd: path.join(proximalPath, "build"),
      env: compilerEnv,
    });
  }

  /**
   * Run 3D reconstruction using CUDA_PROXIMAL_SART
   */
  async runReconstruction(
    inputPath: string,
    outputPath: string,
    options: z.infer<typeof tiltSeriesOptions>,
    gpuId: number,
    logFile?: LogFile
  ): Promise<string> {
    if (!inputPath || !outputPath) {
      throw new ApiError(
        400,
        "Proximal_CryoET: Input path and output path are required"
      );
    }

    await logFile?.writeLog("Proximal_CryoET reconstruction started\n");

    const inputFileAbsolutePath = path.resolve(inputPath);
    const inputFileName = Utils.stripExtension(inputPath);
    const outputAbsolutePath = path.resolve(
      path.join(outputPath, inputFileName)
    );

    // prettier-ignore
    const params = [
      "filename", inputFileAbsolutePath,
      "result_filename", outputAbsolutePath,
      "gpu", gpuId.toString(),
    ];

    // Add reconstruction-specific parameters
    if (options.reconstruction) {
      for (const [key, value] of Object.entries(options.reconstruction)) {
        params.push(key);
        if (typeof value === "boolean") {
          params.push(value ? "1" : "0");
        } else {
          params.push(value.toString());
        }
      }
    }

    await Utils.runScript(
      path.join(this.proximalConfig.path, ProximalCryoETModule.executablePath),
      params,
      null,
      (value) => logFile?.writeLog(value),
      (value) => logFile?.writeLog(value)
    );

    await logFile?.writeLog(
      "\n--------------\nTilt series reconstruction finished\n\nConverting output to raw...\n"
    );

    return outputAbsolutePath;
  }
}
