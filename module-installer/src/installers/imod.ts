import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanDirectory,
  ensureDir,
  isInstalled,
  log,
  removePath,
  restoreFromCache,
  saveToCache,
  type Installer,
} from "../utils.ts";

const IMOD_INSTALLER = "imod_5.1.1_RHEL8-64_CUDA12.0.sh";
const IMOD_URL = `https://bio3d.colorado.edu/imod/AMD64-RHEL5/${IMOD_INSTALLER}`;

// Must match IMODModule.binPath in server.
const IMOD_BIN_PATH = path.join("IMOD", "bin");

export const installImod: Installer = async (context) => {
  const { moduleId, modulesDir, cacheDir, run } = context;
  const imodPath = path.join(modulesDir, "imod");
  if (isInstalled(context, path.join(imodPath, IMOD_BIN_PATH))) {
    return;
  }

  const installerPath = path.join(imodPath, IMOD_INSTALLER);
  const cachedInstallerPath = path.join(cacheDir, IMOD_INSTALLER);

  await ensureDir(imodPath);
  let hasInstaller = existsSync(installerPath);
  if (!hasInstaller) {
    hasInstaller = await restoreFromCache(cachedInstallerPath, installerPath);
    if (hasInstaller) {
      log(moduleId, `Restored ${IMOD_INSTALLER} from cache.`);
    }
  }

  await cleanDirectory(imodPath, new Set([".gitkeep", IMOD_INSTALLER]));

  if (!hasInstaller) {
    await run("wget", ["--no-check-certificate", IMOD_URL], { cwd: imodPath });
    await saveToCache(installerPath, cachedInstallerPath);
  }

  await fs.chmod(installerPath, 0o755);
  await run("sh", [`./${IMOD_INSTALLER}`, "-y", "-skip", "-dir", "./"], {
    cwd: imodPath,
  });
  await removePath(installerPath);
};
