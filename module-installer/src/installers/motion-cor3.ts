import path from "node:path";
import { getEnv, isInstalled, type Installer } from "../utils.ts";

// Must match MotionCor3Module.executablePath in server.
const MOTIONCOR3_EXECUTABLE = "MotionCor3";

export const installMotionCor3: Installer = async (context) => {
  const { modulesDir, run } = context;
  const modulePath = path.join(modulesDir, "motioncor3");
  if (isInstalled(context, path.join(modulePath, MOTIONCOR3_EXECUTABLE))) {
    return;
  }

  const cudaHome = getEnv("MOTIONCOR3_CUDA_HOME", "CUDA_HOME");
  if (!cudaHome) {
    throw new Error(
      "Missing CUDA_HOME for MotionCor3. Set MOTIONCOR3_CUDA_HOME or CUDA_HOME."
    );
  }

  await run("make", ["clean"], { cwd: modulePath, allowFail: true });
  await run("make", ["exe", "-f", "makefile11", `CUDAHOME=${cudaHome}`], {
    cwd: modulePath,
  });
};
