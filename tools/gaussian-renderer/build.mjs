// Bundles the headless test harness together with the real CoCryoViS renderer classes.
import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.resolve(here, "../../client/src");

// Vite's "?raw" shader imports, reproduced for esbuild.
const rawPlugin = { //shaders to text in the .js
  name: "raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      let p = args.path.replace(/\?raw$/, "");
      p = p.startsWith("@/")
        ? path.join(clientSrc, p.slice(2))
        : path.resolve(args.resolveDir, p);
      return { path: p, namespace: "raw" };
    });
    build.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
      contents: await fs.promises.readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

//packer from .ts to .js, which the navigator undestands
await esbuild.build({
  entryPoints: [path.join(here, "src/harness.ts"), path.join(here, "src/viewer.ts")],//2 files that will convert into .js
  bundle: true,
  format: "iife",
  outdir: path.join(here, "dist"),//dir where we take this packed files
  alias: { "@": clientSrc },
  nodePaths: [path.join(here, "node_modules")],
  plugins: [rawPlugin],
  target: "es2022",
  logLevel: "warning",
});
console.log("built dist/harness.js and dist/viewer.js");
