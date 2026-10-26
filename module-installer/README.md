# Module Installer

Downloads and builds the external modules (Ilastik, IMOD, MotionCor3,
GCtfFind, Proximal CryoET) into the top-level `modules/`. The server only contains
the runtime wrappers (`server/src/modules`); this workspace contains
everything needed to install them.

The workspace has no runtime dependencies. Node runs the TypeScript sources
directly using its built-in type stripping (Node 22.6+), so there is no build
step.

## Usage

From the repository root:

```bash
npm run modules:install                          # all modules, in parallel
npm run modules:install -- --only MotionCor3     # selected modules
npm run modules:install -- --skip ilastik,imod   # all but these
npm run modules:install -- --help
```

Module names are case-insensitive and ignore `-`/`_` (`motion-cor3`,
`motioncor3` and `MotionCor3` are the same).

Options:

- `--modules-dir <dir>`: where payloads are installed (default `../modules`),
- `--cache-dir <dir>`: download cache (default `.cache`),
- `--force`: reinstall modules that are already installed.

A module counts as installed when the file the server wrapper runs already
exists (e.g. `motioncor3/MotionCor3`, `ilastik/ilastik/run_ilastik.sh`,
`imod/IMOD/bin`); such modules are skipped unless `--force` is given. Use
`--force --only <id>` to rebuild a single module, e.g. after updating its
submodule. `--force` still reuses downloads from the cache.

Output of each module is prefixed with its name. If a module fails, the
others still finish, and the command exits non-zero listing the failures.

### Environment variables

Read from the shell and from the repository root `.env` (shell values take
precedence). `server/.env` is not read.

| Variable                                                                  | Used by                               | Default                             |
| ------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------- |
| `CUDA_HOME`                                                               | MotionCor3, GCtfFind, Proximal CryoET | required                            |
| `MOTIONCOR3_CUDA_HOME`, `GCTFFIND_CUDA_HOME`, `PROXIMAL_CRYOET_CUDA_HOME` | per-module override of `CUDA_HOME`    |                                     |
| `CUDA_ARCHITECTURES` / `PROXIMAL_CRYOET_CUDA_ARCHITECTURES`               | Proximal CryoET                       | `native`                            |
| `PROXIMAL_CRYOET_GCC_VERSION`                                             | Proximal CryoET                       | first of 12, 11, 13 found on `PATH` |

## Layout

```text
module-installer/
  src/
    install.ts          # CLI + list of installers
    utils.ts            # InstallContext, run(), file/cache helpers
    installers/
      <module>.ts       # one installer per module
  .cache/               # downloaded archives (git-ignored)
```

## Adding a module

1. Add `src/installers/<module>.ts` exporting an `Installer`:

   ```ts
   import path from "node:path";
   import { type Installer } from "../utils.ts";

   export const installMyModule: Installer = async ({ modulesDir, run }) => {
     await run("make", [], { cwd: path.join(modulesDir, "my-module") });
   };
   ```

2. Register it in the `installers` map in `src/install.ts`, using the same
   id as in `server/module_config.json`.

Sources must use only erasable TypeScript syntax (no `enum`, `namespace` or
constructor parameter properties) and import local files with the `.ts`
extension; `npm run -w module-installer tscheck` enforces this.

## Docker

`dockerfiles/Dockerfile` has a `modules` stage that copies only
`module-installer/` and `modules/` and runs `npm run modules:install`.
App code changes therefore never rebuild modules, and the resulting
`modules/` is a separate layer in the runtime image. The `.cache`
directory is a BuildKit cache mount, so downloads survive rebuilds.
