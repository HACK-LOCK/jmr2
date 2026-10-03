# Deployment Guide — Jai Mataji Mobile Repairing

This document outlines the verified deployment architecture, deployment steps, prerequisites, verification procedures, and failure points for the **Jai Mataji Mobile Repairing** system.

---

## 1. Actual Deployment Architecture

The application is architected as a **single-process full-stack monolith**:

```
                 ┌────────────────────────────────────────────────────────┐
                 │                   Browser / Mobile PWA                 │
                 │   - React 18 SPA + Workbox Service Worker (Offline)    │
                 │   - Talk to /api/* (NetworkOnly handler)               │
                 └───────────────────────────┬────────────────────────────┘
                                             │ HTTPS
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Express Server (Node.js >= 20, Single Process on PORT 4000)                             │
│                                                                                        │
│  ├── Static File Server (serves frontend/dist)                                         │
│  │   ├── sw.js, manifest.webmanifest -> Cache-Control: no-cache                        │
│  │   ├── assets/* -> Cache-Control: max-age=31536000, immutable                        │
│  │   └── * (SPA Fallback) -> frontend/dist/index.html                                  │
│  │                                                                                     │
│  ├── REST API (/api/*)                                                                 │
│  │   ├── /api/health (Liveness probe)                                                  │
│  │   ├── /api/auth (JWT authentication, PIN verification, Lockout guards)              │
│  │   ├── /api/orders, /api/customers, /api/parts, /api/suppliers                      │
│  │   ├── /api/orders/:id/pdf (In-memory A5 bill generation via PDFKit)                 │
│  │   └── /api/supabase/* (Cloud sync & restore)                                        │
│  │                                                                                     │
│  └── Persistence Layer (PostgresStore)                                                 │
│      ├── Advisory Lock (pg_advisory_xact_lock) for atomic bill numbering               │
│      └── In-memory snapshot cache with periodic background refresh (DB_REFRESH_MS)    │
└───────────────┬────────────────────────────┬─────────────────────────────┬─────────────┘
                │ Port 5432 (Session Pooler) │ Google APIs (Service Acct)  │ Supabase JS
                ▼                            ▼                             ▼
   ┌─────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────┐
   │    Supabase Postgres    │  │       Google Cloud        │  │  Supabase Edge / API  │
   │  - Tables with RLS      │  │  - Sheets (Read-only tab  │  │  - Client SDK backup  │
   │  - Restricted jmmr_app  │  │    mirror)                │  │    sync and health    │
   │  - Users, bills, stock  │  │  - Drive (PDFs & photos)  │  │                       │
   └─────────────────────────┘  └───────────────────────────┘  └───────────────────────┘
```

### Key Architectural Characteristics
1. **Single Port Execution**: The backend Express server serves both the compiled PWA frontend assets and all `/api/*` endpoints on a single port (default `4000`). No separate frontend web server (Nginx/Apache) is strictly required.
2. **Atomic Bill Numbering**: A centralized counter in the `meta` table produces sequential bill numbers (`JMR-0001`, `JMR-0002`). Concurrency is enforced via Postgres transactional advisory locks (`pg_advisory_xact_lock(728140001)`).
3. **No Silent Fallback**: If `DATABASE_URL` is set, the server strictly refuses to start if Postgres cannot be reached. It does **not** fall back to local file mode, ensuring split-brain data corruption cannot occur.
4. **PWA Offline Resilience**: The frontend bundle includes a Workbox service worker with `skipWaiting` and `clientsClaim`. The API route (`/api/*`) uses `NetworkOnly` to prevent stale financial data from ever being served from cache.

---

## 2. Deployment Prerequisites

Before deploying to production:
1. **Node.js Environment**: Minimum Node.js `v20.0.0` installed on the target host.
2. **Supabase Postgres Instance**:
   - Supabase project created (Region closest to shop, e.g., Mumbai `ap-south-1`).
   - Connection string for **Session pooler** (`aws-0-<region>.pooler.supabase.com:5432`) noted.
   - Database tables and roles provisioned via `npm run db:setup` or `supabase-schema.sql`.
3. **Domain with HTTPS**:
   - HTTPS is **mandatory** for PWA Service Worker registration, camera access for repair photos, and biometric/PWA installation.
   - Can be provided via Cloudflare Tunnel, Caddy reverse proxy, or cloud hosting (Render).
4. **Google Cloud Service Account (Optional)**:
   - Google Cloud project with Google Sheets API and Google Drive API enabled.
   - Service account JSON credentials shared as **Editor** to the target Google Sheet and Drive folder.

---

## 3. Verified Deployment Steps

### Step 1: Database Setup & Provisioning (One-Time)
Run this once from a secure workstation or temporary administrative terminal:
```bash
# Set superuser admin URL temporarily
POSTGRES_ADMIN_URL="postgresql://postgres.<project-ref>:<admin-password>@aws-0-<region>.pooler.supabase.com:5432/postgres" npm run db:setup
```
*What this accomplishes:*
- Creates the restricted application role `jmmr_app` with a generated 48-character password.
- Executes `backend/src/data/postgres/schema.sql`, creating tables with Row Level Security.
- Grants `jmmr_app` access only to shop tables (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
- Generates the initial owner account and prints the production `DATABASE_URL`.
- **Action required:** Record the printed `DATABASE_URL` and owner password. **Never** put `POSTGRES_ADMIN_URL` into production settings.

### Step 2: Verify Database Health
Confirm connectivity using the application role:
```bash
DATABASE_URL="postgresql://jmmr_app:<generated-password>@aws-0-<region>.pooler.supabase.com:5432/postgres" npm run db:check
```
*Expected output:* Confirms connection, displays table row counts, active staff logins, and the next bill number (`JMR-0001`).

### Step 3: Configure Production Environment Variables
On your production hosting provider (e.g. Render Dashboard) or server `.env`, set:
```ini
NODE_ENV=production
PORT=4000
JWT_SECRET=<generated-48-char-hex-secret>
DATABASE_URL=postgresql://jmmr_app:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
STOCK_PIN=9974
ALLOW_NEGATIVE_STOCK=false
DB_REFRESH_MS=2000
SHEETS_MIRROR=true

# If using Google Cloud:
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_DRIVE_ROOT_FOLDER_ID=<drive-folder-id>
GOOGLE_SHEETS_ID=<spreadsheet-id>

# If using direct Supabase client sync:
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

### Step 4: Build the Monorepo
```bash
npm ci
npm run build
```
This produces:
- `frontend/dist/` (client bundle and service worker).
- `backend/dist/` (compiled server entry point).

### Step 5: Start the Production Server
```bash
npm start
```
*Command executed:* `node dist/backend/src/index.js` (from `backend/package.json`).

### Step 6: Verify Deployment Health
Check the HTTP endpoint:
```bash
curl -I http://localhost:4000/api/health
```
*Expected response:*
```json
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"data":{"ok":true,"time":"2026-10-03T05:00:00.000Z"}}
```

---

## 4. Hosting & Infrastructure Options

Based on repository documentation and verified implementations:

### Option A: Render (Cloud Web Service)
- **Documented in:** `docs/SUPABASE_SETUP.md` (lines 111–137).
- **Service Type:** Web Service (Node runtime).
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npm start`
- **Health Check Path:** `/api/health`
- **Disk:** No persistent disk required for billing/accounts (stored in Postgres). *Note: `device-logs.json` resets on redeploy without persistent disk.*

### Option B: Local Shop PC with HTTPS Tunnel
- **Documented in:** `README.md` (lines 253–264).
- **Service Type:** Local Windows or Linux PC running continuously.
- **Tunnel Options:**
  - Cloudflare Tunnel (Free, handles SSL termination, no open inbound firewall ports required).
  - Caddy Reverse Proxy (Automatic Let's Encrypt SSL certificates).
  - ngrok (Temporary testing tunnels).
- **Tunnel target:** `http://localhost:4000`.

---

## 5. Common Deployment Failure Points & Mitigations

### 5.1 Supabase Pooler Port Confusion (Port 5432 vs 6543)
- **Issue:** Supabase provides two pooler ports: **Session Pooler (5432)** and **Transaction Pooler (6543)**.
- **Consequence:** If port 6543 is used, the connection pooler resets transactions between statements, quietly breaking `pg_advisory_xact_lock`. Two devices saving simultaneously can receive duplicate bill numbers.
- **Mitigation:** **Always use port 5432** in `DATABASE_URL`.

### 5.2 Direct Host IPv6 Resolution Failure
- **Issue:** Connecting to `db.<project-ref>.supabase.co` directly.
- **Consequence:** Supabase direct database hosts only have IPv6 DNS records. On networks without full IPv6 routing, DNS lookup fails (`ENOTFOUND` or `ETIMEDOUT`).
- **Mitigation:** Always use the pooler host format: `aws-0-<region>.pooler.supabase.com`. Notice `backend/src/index.ts` also sets `dns.setDefaultResultOrder('ipv4first')` to prevent resolution stalls.

### 5.3 Server Crash on Startup if Database Is Unreachable
- **Issue:** Database temporarily paused or incorrect credentials in `DATABASE_URL`.
- **Consequence:** `PostgresStore.init()` executes `select 1` during boot. If this query fails, the process calls `process.exit(1)`.
- **Mitigation:** Verify database status in Supabase dashboard and run `npm run db:check` before starting the server.

### 5.4 Missing or Blank `STOCK_PIN`
- **Issue:** Omitting `STOCK_PIN` from `.env`.
- **Consequence:** The app starts, but opening **JMR — STOCK** or unhiding dashboard revenue figures returns HTTP 403 (`The shop PIN is not set`).
- **Mitigation:** Always define `STOCK_PIN` (4–12 numeric digits) in the production environment.

### 5.5 Leaving `POSTGRES_ADMIN_URL` in Production Configuration
- **Issue:** Leaving the superuser connection string in production `.env` or Render environment settings.
- **Consequence:** High security exposure; full database superuser privileges exposed in application environment variables.
- **Mitigation:** `POSTGRES_ADMIN_URL` is only used by `postgresSetup.ts`. Once setup finishes, **delete or leave this variable empty** in production.

### 5.6 Ephemeral Container Wiping of `device-logs.json`
- **Issue:** Audit logs recorded by `DeviceLogService` (`backend/src/services/deviceLogs.ts`) write to `path.join(env.dataDir, 'device-logs.json')`.
- **Consequence:** On containerized hosts without persistent storage (like Render's default tier), container redeploys or restarts wipe recent device access logs.
- **Mitigation:** Accept audit log reset across deploys, or attach a Persistent Disk at `backend/.data`.

### 5.7 Service Worker Serving Stale App Versions
- **Issue:** PWA cache retains previous frontend code after a server redeploy.
- **Consequence:** Employees continue viewing older UI until caches are cleared.
- **Mitigation:** `vite.config.ts` includes `registerType: 'autoUpdate'`, `skipWaiting: true`, and `clientsClaim: true`. If an old version persists on a device, navigate to the shop URL, tap logout, clear browser site data, and reload.
