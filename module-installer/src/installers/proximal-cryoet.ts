import { existsSync } from "node:fs";
import path from "node:path";
import {
  getEnv,
  isInstalled,
  log,
  removePath,
  type Installer,
} from "../utils.ts";

/** GCC versions compatible with the CUDA host compiler, in order of preference. */
const SUPPORTED_GCC_VERSIONS = ["12", "11", "13"];

/**
 * Finds the first GCC version for which both gcc-N and g++-N exist on PATH.
 */
function findGccToolchain(
  versions: readonly string[]
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

export const installProximalCryoET: Installer = async (context) => {
  const { moduleId, modulesDir, run } = context;
  const proximalPath = path.join(
    modulesDir,
    "Proximal_CryoET",
    "CUDA_PROXIMAL_SART"
  );
  // Must match ProximalCryoETModule.executablePath in server.
  if (
    isInstalled(context, path.join(proximalPath, "build", "CUDA_PROXIMAL_SART"))
  ) {
    return;
  }

  const cudaArchitectures =
    getEnv("PROXIMAL_CRYOET_CUDA_ARCHITECTURES", "CUDA_ARCHITECTURES") ??
    "native";

  log(
    moduleId,
    `Installing module at ${proximalPath} with CUDA architectures: ${cudaArchitectures}`
  );

  if (!existsSync(path.join(proximalPath, "CMakeLists.txt"))) {
    throw new Error(
      `Proximal_CryoET: Sources not found at ${proximalPath}. Run "git submodule update --init modules/Proximal_CryoET".`
    );
  }

  await removePath(path.join(proximalPath, "build"));

  const requestedGccVersion = getEnv("PROXIMAL_CRYOET_GCC_VERSION");
  const gccVersions = requestedGccVersion
    ? [requestedGccVersion]
    : SUPPORTED_GCC_VERSIONS;
  const toolchain = findGccToolchain(gccVersions);
  if (!toolchain) {
    throw new Error(
      `Proximal_CryoET: No supported GCC toolchain found on PATH (tried gcc-/g++- ${gccVersions.join(", ")}).`
    );
  }

  const cudaHome = getEnv("PROXIMAL_CRYOET_CUDA_HOME", "CUDA_HOME");
  if (!cudaHome) {
    throw new Error(
      "Proximal_CryoET: Missing CUDA_HOME. Set PROXIMAL_CRYOET_CUDA_HOME or CUDA_HOME."
    );
  }
  const nvccPath = path.join(cudaHome, "bin", "nvcc");
  if (!existsSync(nvccPath)) {
    throw new Error(
      `Proximal_CryoET: nvcc not found at ${nvccPath}. Set PROXIMAL_CRYOET_CUDA_HOME or CUDA_HOME.`
    );
  }

  const compilerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CC: toolchain.cc,
    CXX: toolchain.cxx,
    CUDACXX: nvccPath,
    CUDAHOSTCXX: toolchain.cxx,
  };

  await run(
    "cmake",
    ["-S", "./", "-B", "./build", `-DCUDA_ARCHITECTURES=${cudaArchitectures}`],
    { cwd: proximalPath, env: compilerEnv }
  );
  await run("make", [], {
    cwd: path.join(proximalPath, "build"),
    env: compilerEnv,
  });
};
