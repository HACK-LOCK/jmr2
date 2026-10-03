# Environments Guide — Jai Mataji Mobile Repairing

This document outlines the environment configurations, variables, differences, secrets handling, and dependencies for the **Jai Mataji Mobile Repairing** shop manager application, verified directly from the codebase and setup documentation.

---

## 1. Environments Overview

The project codebase supports two primary operational tiers, with distinct persistence and runtime configurations:

| Environment | Purpose | Persistence Adapter | Host / Serving Setup | Status in Repository |
| :--- | :--- | :--- | :--- | :--- |
| **Development** | Local development, testing, and debugging | Local JSON file (`backend/.data/shop-data.json`) or local Postgres | API on `localhost:4000`, Vite dev server on `localhost:5173` with proxy | **VERIFIED** in code & scripts |
| **Production** | Live shop operation (single counter or multi-device) | Supabase Postgres (AWS Mumbai / ap-south-1 or configured region) | Single-process Node.js server serving `/api/*` and static PWA from `frontend/dist` | **VERIFIED** in code & docs |
| **Staging** | Pre-production testing environment | Not defined in repo | Not defined in repo | **UNKNOWN / NEEDS CONFIRMATION** |

> [!NOTE]
> No dedicated staging environment configuration, staging deployment pipeline, or staging `.env` profile exists in this repository. All staging operations currently reuse the development runner or would require a separate Supabase project.

---

## 2. Complete Environment Variables Reference

Configuration is loaded at boot time by `backend/src/config/env.ts` from `.env` in the repository root or current working directory. The frontend Vite build exposes variables prefixed with `VITE_` or `SUPABASE_` (`frontend/vite.config.ts`).

### 2.1 Core Server & Runtime Configuration

| Variable | Default Value | Required in Prod | Description & Source Verification |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | `development` | **YES** | Set to `production` in production. Disables development helpers and switches optimizations. |
| `PORT` | `4000` | Optional | Port on which the Express server listens. |
| `JWT_SECRET` | `insecure-dev-secret-change-me` | **YES** | Secret key used by `jsonwebtoken` to sign and verify employee session tokens. Server logs a warning at boot if left at default. |
| `CORS_ORIGINS` | *(empty string)* | Optional | Comma-separated list of extra allowed origins. Leave empty when PWA is served directly from the same Express origin. |
| `DATA_DIR` | `backend/.data` | Dev only | Local directory for file-based storage (`shop-data.json`, `users.json`, `device-logs.json`). |

### 2.2 Database & Data Store Configuration

| Variable | Default Value | Required in Prod | Description & Source Verification |
| :--- | :--- | :---: | :--- |
| `DATABASE_URL` | *(empty string)* | **YES** *(for multi-device)* | Postgres connection string for the running app. Must use the Supabase **Session pooler** host (`aws-0-<region>.pooler.supabase.com`) on port `5432` with restricted role `jmmr_app`. If set, app strictly requires DB connection and will crash if unreachable. |
| `POSTGRES_ADMIN_URL` | *(empty string)* | **NO** *(Setup only)* | Postgres superuser connection string. Used **only** by `npm run db:setup`. **MUST BE REMOVED/UNSET in production runtime** to avoid exposing superuser credentials. |
| `DATABASE_POOL_MAX` | `10` | Optional | Maximum number of concurrent connections in `pg.Pool`. |
| `DB_REFRESH_MS` | `2000` | Optional | Background polling interval (in milliseconds) for in-memory snapshot updates. Set to `0` for single-till counters. |
| `ALLOW_NEGATIVE_STOCK` | `false` | Optional | When `false`, inventory movements that would result in negative stock are rejected by pure domain logic. |

### 2.3 Shop Security, Staff & Owner Credentials

| Variable | Default Value | Required in Prod | Description & Source Verification |
| :--- | :--- | :---: | :--- |
| `STOCK_PIN` | *(empty string)* | **YES** | 4 to 12 digit PIN protecting the Stock area and hidden revenue metrics on the billing dashboard. Stored only on server; never sent to browser. |
| `STOCK_PIN_TTL_MINUTES` | `120` | Optional | Number of minutes before the Stock area locks again. |
| `STOCK_PIN_MAX_ATTEMPTS` | `5` | Optional | Number of wrong PIN attempts before a 60-second cooldown is enforced. |
| `OWNER_NAME` | `Ashok Bhai` | Optional | Owner name printed on bills and initial user seed. |
| `OWNER_USERNAME` | `ashok` | Optional | Default owner username used during first-time seeding. |
| `OWNER_PASSWORD` | `shop1234` *(dev only)* | **NO** | Initial password for first owner account. In Postgres mode, `npm run db:setup` generates a cryptographically secure random password if this is left blank. |

### 2.4 Google Cloud Integration (Optional: Sheets & Drive)

| Variable | Default Value | Required in Prod | Description & Source Verification |
| :--- | :--- | :---: | :--- |
| `SHEETS_MIRROR` | `true` | Optional | When `true` and Google is connected, records written to Postgres are asynchronously mirrored to Google Sheets as a read-only backup. |
| `GOOGLE_SHEETS_ID` | *(empty string)* | Optional | ID of the Google Sheet copy (from the spreadsheet URL). |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | *(empty string)* | Optional | Root Google Drive folder ID where bill PDFs (`/Bills/<Year>/<Month>/<ORDER-ID>.pdf`) and repair photos are stored. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | *(empty string)* | Optional | Full Google Cloud Service Account credentials JSON stringified into a single line (ideal for cloud hosts like Render). |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | *(empty string)* | Optional | Local file path to Google service account key (e.g., `backend/service-account.json`). If empty, auto-detects any valid JSON key in `backend/`. |
| `GOOGLE_IMPERSONATE_USER` | *(empty string)* | Optional | Google Workspace user email to impersonate for Shared Drive access. |

### 2.5 Supabase Client Direct Integration (Client / Edge Sync)

| Variable | Default Value | Required in Prod | Description & Source Verification |
| :--- | :--- | :---: | :--- |
| `SUPABASE_URL` | `https://uvyszkdszzadoycbmeiy.supabase.co` | Optional | Supabase project API base URL. |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_WQ_...` | Optional | Supabase anon/publishable key used by `@supabase/supabase-js` client for health tests and direct bill backup sync. |
| `VITE_SUPABASE_URL` | `https://uvyszkdszzadoycbmeiy.supabase.co` | Optional | Vite build-time client variable mirroring `SUPABASE_URL`. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_WQ_...` | Optional | Vite build-time client variable mirroring `SUPABASE_PUBLISHABLE_KEY`. |
| `SUPABASE_DISABLED` | `false` | Optional | If `true`, disables direct Supabase client initialization. |

---

## 3. Configuration Differences Across Environments

| Aspect | Local Development | Cloud Production |
| :--- | :--- | :--- |
| **Frontend Serving** | Vite dev server on port `5173` with HMR and proxy to `http://localhost:4000/api` | Express serves precompiled bundle from `frontend/dist` on port `4000` (or `PORT`) |
| **API Endpoints** | Accessible via `http://localhost:4000/api` and proxied from `5173` | Accessible directly via `/api` on same origin |
| **Data Persistence** | `backend/.data/shop-data.json` (atomic file writes) or local Postgres | Supabase Postgres (port `5432`, `jmmr_app` role) |
| **Staff Logins** | `backend/.data/users.json` | `public.users` table in Postgres (bcrypt hashes) |
| **Device Audit Logs** | `backend/.data/device-logs.json` | `backend/.data/device-logs.json` (*Note: ephemeral on container restarts!*) |
| **Database Outage Behavior** | Local file is unaffected | Server intentionally halts on boot if DB is unreachable (prevents split-brain) |
| **PWA Service Worker** | Disabled in dev (`devOptions: { enabled: false }`) | Enabled via Workbox (`registerType: 'autoUpdate'`, network-only for `/api/`) |
| **HTTPS** | Optional (`http://localhost`) | **Mandatory** for PWA installation, offline service worker, and camera permissions |

---

## 4. Secrets Handling & Security Guidelines

1. **`POSTGRES_ADMIN_URL` Superuser URL**:
   - Contains the direct administrative password to the Supabase Postgres instance.
   - **Never** keep this in production environment variables. It must only be provided locally or temporarily during `npm run db:setup`.
2. **`DATABASE_URL` Limited Application Role**:
   - Must use the role `jmmr_app` created by `db:setup`.
   - Permissions granted to `jmmr_app`: `SELECT`, `INSERT`, `UPDATE`, `DELETE` on shop tables only. No `CREATE`, `DROP`, `ALTER`, or `TRUNCATE` privileges.
3. **`JWT_SECRET`**:
   - Must be set to a cryptographically random 48+ character string:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
4. **Google Service Account Credentials**:
   - In cloud hosting (e.g., Render), supply via `GOOGLE_SERVICE_ACCOUNT_JSON` as a single-line string.
   - On local servers, store in `backend/service-account.json`. This file is git-ignored by `.gitignore` rules (`service-account*.json`, `*credentials*.json`, `*key*.json`).
5. **Shop `STOCK_PIN`**:
   - Checked exclusively by backend API (`backend/src/http/routes/auth.ts`) with timing-safe comparisons and attempt lockout guards.
   - Never embedded in frontend bundle or stored in client `localStorage`.
6. **Supabase Publishable Key**:
   - Designed to be public/anon role. Data protection is enforced via Row Level Security (RLS) policies defined in `backend/src/data/postgres/schema.sql` and `supabase-schema.sql`.

---

## 5. Required Services & Dependencies

### Runtime Dependencies
- **Node.js**: Minimum `v20.0.0` (enforced via `package.json` `engines.node`).
- **Postgres Database**: Supabase Postgres (AWS Mumbai / `ap-south-1` recommended for India latency). Connection must use **Session pooler** (`aws-0-<region>.pooler.supabase.com:5432`), not transaction pooler (`6543`), because write concurrency relies on `pg_advisory_xact_lock`.

### Optional External Services
- **Google Cloud Platform**:
  - Google Sheets API v4 (read-only live backup)
  - Google Drive API v3 (PDF bills & photo uploads)
- **Supabase Edge / Data API**: Direct client backup sync via `supabaseSync.ts`.

---

## 6. What is Verified vs Unknown

### Verified from Codebase:
- [x] Exact environment variable names, fallback defaults, and parsing logic (`backend/src/config/env.ts`).
- [x] Storage mode resolution order: Postgres -> Google Sheets -> Local JSON (`backend/src/data/index.ts`).
- [x] Single-origin static asset serving for production PWA (`backend/src/app.ts`).
- [x] Lockout mechanism and attempt limits for `STOCK_PIN` (`backend/src/http/routes/auth.ts`).
- [x] Superuser separation from runtime application role (`backend/src/scripts/postgresSetup.ts`).

### Unknown / Needs Confirmation:
- [ ] **Staging Infrastructure**: Whether a staging database or staging Render instance exists.
- [ ] **Production Host Identity**: Documentation mentions Render as recommended, but actual live host (Render, VPS, physical PC with Cloudflare Tunnel) is not codified in git.
- [ ] **Custom Domain & DNS**: Whether a custom domain (e.g. `shop.jaimataji.in`) is assigned and where SSL termination occurs.
- [ ] **Alerting / Notification Channels**: No email/SMS/webhook alerting service configured for database outages or runtime exceptions.
