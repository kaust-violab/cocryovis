import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { installGCtfFind } from "./installers/gctf-find.ts";
import { installIlastik } from "./installers/ilastik.ts";
import { installImod } from "./installers/imod.ts";
import { installMotionCor3 } from "./installers/motion-cor3.ts";
import { installProximalCryoET } from "./installers/proximal-cryoet.ts";
import { createRun, ensureDir, type Installer } from "./utils.ts";

// Module ids match the keys in server/module_config.json.
const installers: Record<string, Installer> = {
  Ilastik: installIlastik,
  IMOD: installImod,
  MotionCor3: installMotionCor3,
  GCtfFind: installGCtfFind,
  ProximalCryoET: installProximalCryoET,
};

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const usage = `Usage: npm run modules:install -- [options]

Installs/builds all modules in parallel.

Options:
  --only <ids>         Only install these modules (comma-separated or repeated)
  --skip <ids>         Skip these modules (comma-separated or repeated)
  --modules-dir <dir>  Module payload directory (default: ../modules)
  --cache-dir <dir>    Download cache directory (default: .cache)
  --force              Reinstall modules whose output already exists
  -h, --help           Show this help

Modules: ${Object.keys(installers).join(", ")}`;

/** Lets "motion-cor3", "motioncor3" and "MotionCor3" all match. */
const normalize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

const parseIds = (values: string[] | undefined): Set<string> =>
  new Set(
    (values ?? []).flatMap((value) =>
      value.split(",").map(normalize).filter(Boolean)
    )
  );

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      only: { type: "string", multiple: true },
      skip: { type: "string", multiple: true },
      "modules-dir": { type: "string" },
      "cache-dir": { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(usage);
    return;
  }

  const modulesDir = path.resolve(
    values["modules-dir"] ?? path.join(workspaceRoot, "..", "modules")
  );
  const cacheDir = path.resolve(
    values["cache-dir"] ?? path.join(workspaceRoot, ".cache")
  );

  const only = parseIds(values.only);
  const skip = parseIds(values.skip);
  const known = new Set(Object.keys(installers).map(normalize));
  const unknown = [...only, ...skip].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown module(s): ${unknown.join(", ")}\n\n${usage}`);
  }

  const selected = Object.keys(installers).filter((moduleId) => {
    const id = normalize(moduleId);
    return (only.size === 0 || only.has(id)) && !skip.has(id);
  });

  console.log(`[modules] Installing ${selected.join(", ")} into ${modulesDir}`);

  const results = await Promise.allSettled(
    selected.map(async (moduleId) => {
      const moduleCacheDir = path.join(cacheDir, moduleId);
      await ensureDir(moduleCacheDir);
      await installers[moduleId]!({
        moduleId,
        modulesDir,
        cacheDir: moduleCacheDir,
        force: values.force,
        run: createRun(moduleId),
      });
      console.log(`[modules] ${moduleId} completed successfully.`);
    })
  );

  const failed = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${selected[index]}: ${String(result.reason)}`]
      : []
  );
  if (failed.length > 0) {
    throw new Error(`Failed modules:\n  ${failed.join("\n  ")}`);
  }

  console.log("[modules] All selected modules installed successfully.");
};

main().catch((error: unknown) => {
  console.error(
    `\n[modules] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
