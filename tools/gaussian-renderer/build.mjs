// Bundles the headless test harness together with the real CoCryoViS renderer classes.
import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.resolve(here, "../../client/src");

// Vite's "?raw" shader imports, reproduced for esbuild.
const rawPlugin = {
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

await esbuild.build({
  entryPoints: [path.join(here, "src/harness.ts")],
  bundle: true,
  format: "iife",
  outfile: path.join(here, "dist/harness.js"),
  alias: { "@": clientSrc },
  nodePaths: [path.join(here, "node_modules")],
  plugins: [rawPlugin],
  target: "es2022",
  logLevel: "warning",
});
console.log("built dist/harness.js");
