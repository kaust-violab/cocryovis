import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { Readable } from "node:stream";

export interface InstallContext {
  moduleId: string;
  /** Top-level modules/ — where module payloads are installed. */
  modulesDir: string;
  /** Per-module download cache, kept between installs. */
  cacheDir: string;
  /** Reinstall even if the module's output already exists. */
  force: boolean;
  /** Runs a command, prefixing its output with the module id. */
  run: (command: string, args: string[], options: RunOptions) => Promise<void>;
}

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  allowFail?: boolean;
}

export type Installer = (context: InstallContext) => Promise<void>;

const pipeWithPrefix = (
  stream: Readable,
  target: NodeJS.WriteStream,
  prefix: string
): void => {
  readline
    .createInterface({ input: stream, crlfDelay: Infinity })
    .on("line", (line) => target.write(`${prefix} ${line}\n`));
};

export const createRun =
  (moduleId: string): InstallContext["run"] =>
  (command, args, options) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ["inherit", "pipe", "pipe"],
      });
      pipeWithPrefix(child.stdout, process.stdout, `[${moduleId}]`);
      pipeWithPrefix(child.stderr, process.stderr, `[${moduleId}]`);

      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0 || (options.allowFail ?? false)) {
          resolve();
          return;
        }
        reject(
          new Error(
            `Command failed (${String(code ?? "unknown")}): ${command} ${args.join(" ")}`
          )
        );
      });
    });

export const log = (moduleId: string, message: string): void => {
  console.log(`[${moduleId}] ${message}`);
};

/** Returns the value of the first environment variable that is set. */
export const getEnv = (...names: string[]): string | undefined =>
  names.map((name) => process.env[name]).find(Boolean);

/**
 * Returns whether the module is already installed, i.e. `outputPath` exists
 * and `--force` was not given. Logs the skip.
 */
export const isInstalled = (
  { moduleId, modulesDir, force }: InstallContext,
  outputPath: string
): boolean => {
  if (force || !existsSync(outputPath)) {
    return false;
  }
  log(
    moduleId,
    `${path.relative(modulesDir, outputPath)} already exists. Skipping install (use --force to reinstall).`
  );
  return true;
};

export const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

/** Removes everything in a directory except the names in `preserve`. */
export const cleanDirectory = async (
  dirPath: string,
  preserve = new Set([".gitkeep"])
): Promise<void> => {
  const entries = await fs.readdir(dirPath);
  for (const entry of entries) {
    if (!preserve.has(entry)) {
      await fs.rm(path.join(dirPath, entry), { recursive: true, force: true });
    }
  }
};

export const removePath = (targetPath: string): Promise<void> =>
  fs.rm(targetPath, { recursive: true, force: true });

export const movePath = async (
  source: string,
  destination: string
): Promise<void> => {
  await removePath(destination);
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    // Keep relative symlinks pointing inside the copy.
    await fs.cp(source, destination, {
      recursive: true,
      verbatimSymlinks: true,
    });
    await removePath(source);
  }
};

/** Copies `cachedFile` to `targetFile` if it exists; returns whether it did. */
export const restoreFromCache = async (
  cachedFile: string,
  targetFile: string
): Promise<boolean> => {
  if (!existsSync(cachedFile)) {
    return false;
  }
  await ensureDir(path.dirname(targetFile));
  await fs.copyFile(cachedFile, targetFile);
  return true;
};

export const saveToCache = async (
  sourceFile: string,
  cachedFile: string
): Promise<void> => {
  await ensureDir(path.dirname(cachedFile));
  await fs.copyFile(sourceFile, cachedFile);
};
