import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanDirectory,
  ensureDir,
  isInstalled,
  log,
  movePath,
  removePath,
  restoreFromCache,
  saveToCache,
  type Installer,
} from "../utils.ts";

const ILASTIK_ARCHIVE = "ilastik-1.4.0b21-gpu-Linux.tar.gz";
const ILASTIK_GDOWN_ID = "1T1zKnYqRB119wc84iE1rwwvmAgFI5JOa";

// Must match IlastikModule.ilastikRoot / IlastikModule.inferencePath in server.
const ILASTIK_ROOT = "ilastik";
const ILASTIK_INFERENCE_PATH = path.join(ILASTIK_ROOT, "run_ilastik.sh");

export const installIlastik: Installer = async (context) => {
  const { moduleId, modulesDir, cacheDir, run } = context;
  const ilastikPath = path.join(modulesDir, "ilastik");
  if (isInstalled(context, path.join(ilastikPath, ILASTIK_INFERENCE_PATH))) {
    return;
  }
  await ensureDir(ilastikPath);

  const archivePath = path.join(ilastikPath, ILASTIK_ARCHIVE);
  const cachedArchivePath = path.join(cacheDir, ILASTIK_ARCHIVE);

  let hasArchive = existsSync(archivePath);
  if (!hasArchive) {
    hasArchive = await restoreFromCache(cachedArchivePath, archivePath);
    if (hasArchive) {
      log(moduleId, `Restored ${ILASTIK_ARCHIVE} from cache.`);
    }
  }

  if (hasArchive) {
    log(moduleId, `${ILASTIK_ARCHIVE} already exists. Skipping download.`);
    await cleanDirectory(ilastikPath, new Set([".gitkeep", ILASTIK_ARCHIVE]));
  } else {
    await cleanDirectory(ilastikPath);
    await run("python3", ["-m", "venv", "./venv"], { cwd: ilastikPath });
    await run("./venv/bin/pip", ["install", "--upgrade", "pip"], {
      cwd: ilastikPath,
    });
    await run("./venv/bin/pip", ["install", "--upgrade", "gdown"], {
      cwd: ilastikPath,
    });
    await run("./venv/bin/gdown", [ILASTIK_GDOWN_ID, "-O", ILASTIK_ARCHIVE], {
      cwd: ilastikPath,
    });
    await saveToCache(archivePath, cachedArchivePath);
    await removePath(path.join(ilastikPath, "venv"));
  }

  const extractPath = path.join(ilastikPath, "extracted");
  await ensureDir(extractPath);
  await run("tar", ["-xf", `./${ILASTIK_ARCHIVE}`, "-C", "./extracted"], {
    cwd: ilastikPath,
  });

  const items = await fs.readdir(extractPath, { withFileTypes: true });
  const dir = items.find((item) => item.isDirectory());
  if (!dir) {
    throw new Error(`No directory found in ${ILASTIK_ARCHIVE}`);
  }

  await movePath(
    path.join(extractPath, dir.name),
    path.join(ilastikPath, ILASTIK_ROOT)
  );
  await removePath(extractPath);
  await removePath(archivePath);
};
