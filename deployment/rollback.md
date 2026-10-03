# Rollback Guide — Jai Mataji Mobile Repairing

This document outlines the rollback procedures, limitations, database migration considerations, and deployment failure recovery mechanisms for the **Jai Mataji Mobile Repairing** system.

---

## 1. Current Rollback Capability Overview

The system's rollback capabilities differ significantly between the application runtime layer and the database persistence layer:

| Component | Rollback Capability | Mechanism | Automated? |
| :--- | :--- | :--- | :---: |
| **Frontend UI Bundle** | **High** | Git checkout / rebuild or host version revert | Manual / Platform |
| **Backend API Code** | **High** | Git checkout / rebuild or host version revert | Manual / Platform |
| **Environment Config** | **High** | Revert environment variable in host dashboard or `.env` | Manual |
| **Database Schema** | **LOW / MANUAL** | Requires manual SQL execution in Supabase Dashboard | **NO** |
| **Database Data** | **Medium** | Supabase point-in-time backup or app JSON export | Manual |
| **Device Audit Logs** | **None** | Ephemeral file (`backend/.data/device-logs.json`) | **NO** |

---

## 2. Previous-Version Recovery Process

If a newly deployed release introduces unexpected behavior or errors, follow these steps to recover the previous stable state:

### 2.1 Cloud Hosting (e.g. Render)
1. Navigate to the **Deploys** tab in the hosting dashboard.
2. Locate the last known good deployment.
3. Click **Rollback to this deploy** (or re-trigger the previous commit).
4. Verify that the rollback build completes and `/api/health` returns `200 OK`.

### 2.2 Self-Hosted / Local Machine
1. Check out the previous stable git commit or tag:
   ```bash
   git checkout <previous-stable-commit-or-tag>
   ```
2. Reinstall dependencies deterministically:
   ```bash
   npm ci
   ```
3. Rebuild both workspaces:
   ```bash
   npm run build
   ```
4. Restart the server process:
   ```bash
   npm start
   ```
5. Confirm application health:
   ```bash
   curl -I http://localhost:4000/api/health
   ```

---

## 3. Database Migration Considerations

> [!CAUTION]
> The project does **NOT** include an automated migration tool (such as Prisma Migrate, Knex, Flyway, or Liquibase). There are no automated down-migrations (`down()` scripts).

### 3.1 How Database Changes Are Managed
- The canonical database schema is defined in `backend/src/data/postgres/schema.sql` and mirrored in `supabase-schema.sql`.
- Statements are structured to be idempotent (using `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ON CONFLICT (id) DO NOTHING`).
- Schema updates are applied manually by running `npm run db:setup` or running SQL in the Supabase SQL editor.

### 3.2 Schema Rollback Rules
1. **Never Drop Columns Immediately**:
   - Rolling back application code while dropping a database column causes the previous application code to crash when querying that column.
   - Always retain columns in the database even if reverting backend code that used them.
2. **Never Decrement `meta.order_sequence`**:
   - The central sequence counter in the `meta` table determines bill numbering (`JMR-0001`, `JMR-0002`).
   - If a rollback occurs after new bills were generated, **never** reset or decrement `order_sequence`. Resetting it would re-issue duplicate bill numbers, corrupting Google Drive filing paths (`Bills/<Year>/<Month>/<ORDER-ID>.pdf`) and spreadsheet mirrors.
3. **Data Loss on Table Deletion**:
   - Foreign key constraints with `ON DELETE CASCADE` exist on `payments`, `order_parts`, and `status_history`. Deleting an order cascades to all associated payment and part records.

---

## 4. Configuration Rollback

If an error is caused by a configuration change (such as an incorrect `DATABASE_URL`, changed `STOCK_PIN`, or corrupted `GOOGLE_SERVICE_ACCOUNT_JSON`):

1. Revert the changed key in `.env` (or in the cloud host's Environment Variables panel).
2. **Restart the server process**:
   - Environment variables are read once during application startup (`backend/src/config/env.ts`).
   - Modifying `.env` or cloud settings has **no effect** until the process restarts.
3. Validate configuration with pre-flight check tools:
   ```bash
   # Check Postgres connection
   npm run db:check

   # Check Google Cloud connection
   npm run google:check
   ```

---

## 5. Deployment Failure Recovery

### Scenario 1: Server Exits with Code 1 on Boot ("could not reach the database")
- **Cause:** `PostgresStore.init()` failed its initial `select 1` connectivity probe.
- **Recovery Steps:**
  1. Open the Supabase dashboard and confirm the project status is not "Paused" (free-tier projects pause after inactivity).
  2. Test the connection string locally: `npm run db:check`.
  3. Ensure the pooler URL uses port `5432` (**Session pooler**), not `6543`.
  4. Ensure the password has not expired or been reset in Supabase.

### Scenario 2: Frontend Loads but Shows Outdated Version (PWA Stale Cache)
- **Cause:** Service worker cached previous version assets on the client browser.
- **Recovery Steps:**
  1. Have the user tap the **Sign Out** button in the app.
  2. Clear browser site data / storage for the domain.
  3. Perform a hard reload (`Ctrl+F5` on desktop, or close and reopen the installed PWA on mobile).
  4. Verify the build timestamp in **JMR — STOCK → Settings**.

### Scenario 3: Stock Area or Revenue Figures Return HTTP 403
- **Cause:** `STOCK_PIN` was cleared, changed, or failed attempt lockout triggered.
- **Recovery Steps:**
  1. Check that `STOCK_PIN` is set in production environment variables.
  2. If an employee triggered the attempt guard (5 wrong tries), wait 60 seconds for the in-memory cooldown to expire (`auth.ts` lines 41–46), or restart the server process to immediately clear the lockout map.

---

## 6. Clearly Marked Unimplemented Features

The following deployment and rollback capabilities are **NOT IMPLEMENTED** in this codebase:

- [ ] **Automated Down-Migrations**: No reverse migration runner or down scripts exist.
- [ ] **Zero-Downtime Blue/Green Deployment**: No automated routing switch between old and new server versions.
- [ ] **Automated Health Check Rollback**: The deployment process does not automatically revert git commits if `/api/health` fails.
- [ ] **Persistent Cloud Storage for Device Logs**: `device-logs.json` lives on the local filesystem. Rolling back or restarting ephemeral cloud instances clears recent device logs.
- [ ] **Automated Database Backups Outside Supabase**: No automated cron script exports daily database snapshots to offsite cloud buckets (users must rely on Supabase platform backups or manual **Settings → Export**).
