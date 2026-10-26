# Modules System

## Overview

The modules system is a config-driven plugin pipeline for external tooling.

- Configuration registry: `module_config.json`
- Wrapper classes: `src/modules`
- External binaries/models/artifacts: top-level `modules/` (outside `server/`)
- Tooling entry point: `src/tools/create-module-template.ts`
- Installation (download/build of payloads): the separate [`module-installer`](../../module-installer/README.md) workspace

Core goals:

- deterministic module discovery,
- minimal boilerplate for new modules,
- reusable install/runtime primitives,
- explicit separation between orchestration and payload.

## Topology

```text
modules/                        # External module payloads (git submodules + installed tools)
module-installer/               # Downloads/builds payloads into modules/
server/
  module_config.json            # Module registry
  src/
    modules/                    # TypeScript wrappers
      base-module.ts
      *-module.ts
    tools/                      # Orchestration scripts
      module-config-utils.ts
      create-module-template.ts
```

## Registry

Each top-level key in `module_config.json` is a module id.

Each entry must be an object. Its fields are module-specific runtime/install
configuration (for example `path`); the module id is what handlers pass to
`moduleConfigLoader.getModuleConfig(...)` and what `modules:install` accepts.

Example:

```json
{
  "MotionCor3": {
    "path": "../modules/motioncor3/"
  }
}
```

## Base Module Interface

`src/modules/base-module.ts` defines the module contract.

### Validation helpers

- `validatePathExists`
- `validateFileExists`
- `validateDirectoryExists`

Use these for fail-fast runtime checks in wrapper constructors and module methods.

## Install Pipeline

Payloads in the top-level `modules/` are downloaded/built by the
[`module-installer`](../../module-installer/README.md) workspace, not by the
server. From the repository root:

```bash
npm run modules:install
npm run modules:install -- --only MotionCor3
npm run modules:install -- --skip ilastik,imod
```

## Create Pipeline

Command:

```bash
npm run modules:create -- <module-id-or-name> [--force]
```

Script: `src/tools/create-module-template.ts`

### Execution algorithm

1. parse positional module input,
2. derive id (`PascalCase`) and slug (`kebab-case`),
3. create wrapper template in `src/modules/<slug>-module.ts`,
4. create payload directory `../modules/<slug>/` (top-level `modules/`),
5. append entry in `module_config.json`.

Derived defaults:

- class name: `<ModuleId>Module`,
- path: `../modules/<slug>/` (relative to `server/`, the server's working directory).

Examples:

```bash
npm run modules:create -- "Super Module"
npm run modules:create -- NanoOetzi
npm run modules:create -- TestModule --force
```

## Adding a New Module

1. Scaffold:

```bash
npm run modules:create -- "My Module"
```

2. If the module needs a download/build step, add an installer to
   `module-installer` (see its README).

3. Add and validate runtime schema (recommended): parse module-specific settings from `module_config.json` with zod.

4. Test installer path (from the repository root):

```bash
npm run modules:install -- --only MyModule
```

## Quick Commands

```bash
# Scaffold module wrapper and registry entry
npm run modules:create -- MyModule

# Overwrite generated wrapper template
npm run modules:create -- MyModule --force

# Install/build module payloads (from the repository root)
npm run modules:install
```
