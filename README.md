# CoCryoVis

CoCryoVis is a full-stack platform for cryo-ET volume management, annotation workflows, model training/inference orchestration, and result visualization.

This repository is organized as a multi-package workspace:

- `server/`: Node.js + TypeScript API, Prisma (SQLite), modules, and static client hosting.
- `client/`: React + Vite frontend.
- `schemas/`: Shared schema package consumed by server and client.
- `modules/`: External module payloads (git submodules and installed tools) used by the server.
- `module-installer/`: Downloads and builds the external modules into `modules/`.
- `dockerfiles/`: Container build and deploy definitions.

## Prerequisites

- Node.js 22+
- npm
- Python environment for server-side scripts (`server/requirements.txt`)
- Git submodules

Optional but recommended for GPU modules:

- NVIDIA drivers + CUDA toolkit (tested with CUDA 12.4)
- CMake 3.24+ (required by Proximal CryoET build path)

## Quick Start (Local Development)

### 1. Clone and initialize submodules

```bash
git clone --recurse-submodules <repo-url>
cd vol-web-server-dev
```

### 2. Install JavaScript dependencies (workspace)

```bash
npm install
```

### 3. Install Python dependencies

From `server/`:

```bash
pip install -r requirements.txt
```

### 4. Configure server environment

Create `server/.env`:

```env
# SQLite database path (relative to server/prisma)
DATABASE_URL=file:./../database/db.sqlite

# Required for session signing
SESSION_SECRET=change-me

# Optional admin seed credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

Additional optional runtime variables:

- `PORT`, `HOST`
- `HTTPS=true` with `SSL_KEY_PATH`/`SSL_CRT_PATH` or base64 `SSL_KEY_CONTENT`/`SSL_CRT_CONTENT`
- `SESSIONS_PATH` (default: `./database/sessions.db`)
- `ALLOW_INSECURE_COOKIES=true` (only for non-production or controlled environments)

### 5. Initialize database and seed

From `server/`:

```bash
npm run prisma:init
npm run prisma:seed
```

### 6. Run in development

Terminal 1, from `server/`:

```bash
npm run dev -- --host 0.0.0.0 --port 8080
```

Terminal 2, from `client/`:

```bash
npm run dev
```

The client defaults to `http://localhost:8080` for API calls. Override with `VITE_API_URL` when needed.

## Production-Style Local Run

Build from the workspace root, then run the unified production startup (Prisma deploy + seed + server start):

```bash
npm run build:prod
npm run start:prod
```

## Modules System

Module wrappers and templates are managed from `server/`; downloading/building the module payloads is done by the separate `module-installer/` workspace. \
Detailed module architecture and conventions are provided in [modules-system.md](server/docs/modules-system.md) and [module-installer/README.md](module-installer/README.md).

Install/download all modules (in parallel, from the repository root):

```bash
npm run modules:install
```

Skip selected modules:

```bash
npm run modules:install -- --skip Ilastik --skip ProximalCryoET
```

Install only specific modules:

```bash
npm run modules:install -- --only MotionCor3
```

Create a new module wrapper + config entry (from `server/`):

```bash
npm run modules:create -- <module-id-or-name>
```

### Current modules:

- [Ilastik](https://www.ilastik.org)
- [Nano-Ötzi](https://github.com/nanovis/nano-oetzi)
- [Proximal CryoET](https://github.com/juareyra/Proximal_CryoET/)
- [MotionCor3](https://github.com/czimaginginstitute/MotionCor3)
- [GCtfFind](https://github.com/czimaginginstitute/GCtfFind)
- [IMOD](https://bio3d.colorado.edu/imod/)

## Docker

Container assets are in `dockerfiles/`.

Typical local run:

```bash
cd dockerfiles
docker compose -f compose.yml up --build
```

Notes:

- Compose setup assumes GPU-capable runtime (`gpus: all`).
- Modules are built in their own stage from `module-installer/` and `modules/` only, so app code changes don't rebuild them.
- The container startup uses `npm run start:prod` (runs Prisma deploy + seed, then starts server).
- Configure credentials/secrets with environment variables (`SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`).

## Useful Commands

From `server/`:

- `npm run dev`: start API in development mode
- `npm run build`: build TypeScript output
- `npm run start:prod`: run production startup (Prisma deploy + seed + `start`)
- `npm start`: run compiled server (`dist/index.js`)
- `npm run prisma:db`: open Prisma Studio

From `client/`:

- `npm run dev`: start Vite dev server
- `npm run build`: build production bundle
