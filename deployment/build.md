# Build Guide — Jai Mataji Mobile Repairing

This document outlines the build system, prerequisites, commands, artifacts, and build-time configuration for the **Jai Mataji Mobile Repairing** repository, verified against `package.json`, `tsconfig*.json`, and `vite.config.ts`.

---

## 1. Prerequisites

Before building the application, ensure the host system satisfies the following verified requirements:

| Component | Minimum Version | Verified Location | Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | `>= 20.0.0` | `package.json` (`engines.node`) | Required for native crypto, fetch, and modern ECMAScript features. |
| **npm** | `>= 9.0.0` (Workspaces) | `package.json` (`workspaces`) | Root package utilizes npm workspaces (`backend` and `frontend`). |
| **Operating System** | Windows, Linux, macOS | Cross-platform | Code uses `node:path` and cross-platform Node APIs. |
| **Allowed Scripts** | `esbuild` permissions | `package.json` (`allowScripts`) | `esbuild@0.28.2` and `esbuild@0.25.12` approved for build execution. |

---

## 2. Dependency Installation

The repository is structured as a monorepo with two workspaces:
```
jai-mataji-repair-shop/
├── backend/    (@shop/backend)
├── frontend/   (@shop/frontend)
└── shared/     (pure domain logic imported by both)
```

### Production Clean Install (Recommended)
```bash
npm ci
```
*Rules and Behavior:*
- Installs exact versions recorded in the root `package-lock.json`.
- Automatically links workspaces (`@shop/backend`, `@shop/frontend`) and installs top-level build dependencies (`concurrently`, `typescript`, `esbuild`).

### Developer Install
```bash
npm install
```

---

## 3. Verified Build Commands

### 3.1 Full Monorepo Build (Standard)
```bash
npm run build
```
This root command runs sequential workspace builds:
1. `npm run build --workspace frontend`
2. `npm run build --workspace backend`

### 3.2 Frontend Build
```bash
npm run build --workspace frontend
```
*Exact command executed:* `tsc -b && vite build`
1. **`tsc -b`**: Runs TypeScript project compilation in check mode (`noEmit: true` in `frontend/tsconfig.json`) to verify type safety across JSX/TSX components.
2. **`vite build`**: Invokes Vite 6 to bundle React 18, Tailwind CSS, Lucide icons, and Radix UI components into optimized production assets, and generates the Workbox PWA service worker.

### 3.3 Backend Build
```bash
npm run build --workspace backend
```
*Exact command executed:* `tsc -p tsconfig.build.json`
1. Compiles TypeScript from `backend/src/` and `shared/` into CommonJS JavaScript in `backend/dist/`.
2. **Excluded files**: `backend/tsconfig.build.json` explicitly excludes `src/scripts/**` (the CLI scripts like `seed.ts`, `postgresSetup.ts`, `postgresCheck.ts`, and `dbRules.ts`) so development/admin tools do not bloat the production bundle.
3. Common output root: Because `backend/tsconfig.json` includes `../shared/**/*.ts`, TypeScript preserves directory structure under `backend/dist/` (`backend/dist/backend/src/index.js` and `backend/dist/shared/domain.js`).

### 3.4 Typecheck Verification (Without Building)
```bash
npm run typecheck
```
Executes:
- `npm run typecheck --workspace backend` (`tsc --noEmit`)
- `npm run typecheck --workspace frontend` (`tsc --noEmit`)

---

## 4. Platform-Specific Build Nuances

1. **Windows vs Linux Shells**:
   - `package.json` scripts use npm workspace flags (`--workspace`) that work uniformly across PowerShell, cmd.exe, and POSIX shells (`bash`/`sh`).
   - In `backend/scripts/run-api-tests.mjs`, invoking `npm` or `npm.cmd` via `child_process.spawn` is intentionally avoided because Windows `cmd.exe` behaves inconsistently across Node versions. The test harness directly runs `node_modules/typescript/bin/tsc` via `process.execPath`.
2. **Path Resolution & Repository Root Climbing**:
   - `backend/src/config/env.ts` implements `findRepoRoot()`, walking up directory levels to locate `shared/domain.ts`. This ensures correct `.env` and `frontend/dist` path resolution whether executing from TypeScript source (`tsx src/index.ts`) or compiled JavaScript (`node dist/backend/src/index.js`).
3. **Asset Path Separators in Static Serving**:
   - `backend/src/app.ts` checks cache headers using `path.sep` (`path.sep + 'assets' + path.sep`), correctly matching forward slashes on Linux and backslashes on Windows.

---

## 5. Generated Artifacts

### 5.1 Frontend Build Output (`frontend/dist/`)
```
frontend/dist/
├── index.html                 # Main Single Page Application HTML shell
├── assets/                    # Hashed production JS and CSS bundles
│   ├── index-[hash].js        # Core React application bundle
│   └── index-[hash].css       # Compiled Tailwind CSS bundle
├── sw.js                      # Workbox PWA service worker with autoUpdate strategy
├── registerSW.js              # Service worker registration script
├── manifest.webmanifest       # PWA web app manifest (name, colors, icons, shortcuts)
├── favicon.svg                # Favicon asset
└── icons/                     # PWA icons (icon-192.png, icon-512.png, icon-maskable-512.png)
```

### 5.2 Backend Build Output (`backend/dist/`)
```
backend/dist/
├── backend/
│   └── src/
│       ├── index.js           # Server boot entry point (run by "npm start")
│       ├── index.js.map       # Source map
│       ├── app.js             # Express app setup and router assembly
│       ├── config/            # Parsed environment configuration
│       ├── core/              # ID generation, error definitions
│       ├── data/              # Storage adapters (Postgres, Local, Sheets)
│       ├── domain/            # Pure business logic (orders, stock, pricing)
│       ├── google/            # Google Sheets & Drive API integrations
│       ├── http/              # Express route controllers & middleware
│       ├── pdf/               # PDFKit A5 bill generation
│       └── services/          # Business services & Supabase client sync
└── shared/
    ├── domain.js              # Shared constant tables, types, money math
    └── domain.js.map          # Source map
```

---

## 6. Build-Time Environment & Configuration

1. **`__BUILD_TIME__` Constant**:
   - Defined in `frontend/vite.config.ts`:
     ```ts
     define: {
       __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
     }
     ```
   - Injected into the frontend bundle and displayed under **Stock & Management → Settings**, allowing immediate verification of whether a client is running the newest release.
2. **Vite Client Environment Variables**:
   - Vite reads variables from root `.env` (`envDir: path.resolve(__dirname, '..')`).
   - Prefixes exposed to client bundle: `VITE_` and `SUPABASE_`.
   - Variables baked into client:
     - `VITE_SUPABASE_URL` / `SUPABASE_URL`
     - `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY`
   - *Security Note:* Never prefix secret tokens (like `JWT_SECRET` or `POSTGRES_ADMIN_URL`) with `VITE_` or `SUPABASE_`, as Vite will expose them in client JS.

---

## 7. Step-by-Step Verified Build Verification Pipeline

To verify the integrity of the build locally or in a deployment pipeline:

```bash
# 1. Install exact dependencies
npm ci

# 2. Verify static types across frontend and backend
npm run typecheck

# 3. Compile both frontend and backend
npm run build

# 4. Verify test suites
npm test
```

Verification output checkpoints:
- Frontend typecheck passes with no diagnostics.
- Vite logs generated bundles and PWA manifest.
- Backend TypeScript compilation completes with no errors.
- `npm test` runs:
  1. `test:rules` (pure DB rules & order numbering checks) -> prints `ok` for all assertions.
  2. `test:render` (virtual DOM markup check) -> prints `ALL SCREENS RENDER CLEANLY`.
  3. `test:api` (spawns throwaway server on port 4100) -> runs smoke and e2e suites -> prints `ALL CHECKS PASSED`.
