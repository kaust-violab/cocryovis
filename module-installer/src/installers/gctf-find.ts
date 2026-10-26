import path from "node:path";
import { getEnv, isInstalled, type Installer } from "../utils.ts";

// Must match GCtfFindModule.executablePath in server.
const GCTFFIND_EXECUTABLE = "GCtfFind";

export const installGCtfFind: Installer = async (context) => {
  const { modulesDir, run } = context;
  const modulePath = path.join(modulesDir, "gctffind");
  if (isInstalled(context, path.join(modulePath, GCTFFIND_EXECUTABLE))) {
    return;
  }

  const cudaHome = getEnv("GCTFFIND_CUDA_HOME", "CUDA_HOME");
  if (!cudaHome) {
    throw new Error(
      "Missing CUDA_HOME for GCtfFind. Set GCTFFIND_CUDA_HOME or CUDA_HOME."
    );
  }

  await run("make", ["clean"], { cwd: modulePath, allowFail: true });
  await run("make", ["exe", "-f", "makefile", `CUDAHOME=${cudaHome}`], {
    cwd: modulePath,
  });
};
