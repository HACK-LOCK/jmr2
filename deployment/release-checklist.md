# Pre-Release & Deployment Checklist — Jai Mataji Mobile Repairing

This checklist is a practical, production-ready verification guide designed to ensure zero downtime, prevent data corruption, and safeguard financial and repair records before and after deploying **Jai Mataji Mobile Repairing**.

---

## Phase 1: Code & Build Validation

- [ ] **Clean Working Directory**: Ensure all local changes are committed and working tree is clean (`git status`).
- [ ] **Typecheck Verification**: Run `npm run typecheck` to verify TypeScript typing across both frontend and backend workspaces.
- [ ] **Production Build Test**: Run `npm run build` and ensure both output directories are generated without warnings:
  - [ ] `frontend/dist/` contains `index.html`, `assets/`, `sw.js`, and `manifest.webmanifest`.
  - [ ] `backend/dist/` contains `backend/src/index.js` and `shared/domain.js`.
- [ ] **Build Time Verification**: Check that `__BUILD_TIME__` in `frontend/vite.config.ts` matches current timestamp.

---

## Phase 2: Automated Test Execution

Run the complete project automated test suite:
- [ ] **Comprehensive Test Suite**: Execute `npm test`
  - [ ] `test:rules` passed: Verifies sequential bill numbering (`JMR-0001`), sequence recovery, and money calculation rules without requiring a database.
  - [ ] `test:render` passed: Verifies all screens render cleanly without missing `<label for>` attributes, missing form IDs, or stock numbers leaking into billing.
  - [ ] `test:api` passed: Spawns an isolated throwaway server on port `4100` and executes both `smoke.mjs` and `e2e.mjs` against a temporary data directory.
- [ ] **Supabase Storage Check**: Execute `npm run test:supabase:storage` to verify cloud table read/write permissions.

---

## Phase 3: Environment & Secrets Configuration

- [ ] **Production Mode**: Verify `NODE_ENV=production` is set in the hosting environment.
- [ ] **Secure JWT Secret**: Ensure `JWT_SECRET` is set to a cryptographically secure random string (minimum 48 hex characters). Never use `insecure-dev-secret-change-me`.
- [ ] **Shop PIN Configured**: Verify `STOCK_PIN` is set to a 4–12 digit numeric string.
- [ ] **Database URL Verification**:
  - [ ] `DATABASE_URL` uses the **Session pooler** host (`aws-0-<region>.pooler.supabase.com`) on port **5432**.
  - [ ] `DATABASE_URL` uses the restricted application role `jmmr_app` (never `postgres` superuser).
- [ ] **Remove Superuser Admin URL**: Ensure `POSTGRES_ADMIN_URL` is **empty or unset** in the production environment.
- [ ] **Google Cloud Configuration (if enabled)**:
  - [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` is valid single-line JSON.
  - [ ] `GOOGLE_DRIVE_ROOT_FOLDER_ID` is set to the shared Drive folder.
  - [ ] `GOOGLE_SHEETS_ID` is set to the shared spreadsheet.
  - [ ] Run `npm run google:check` to verify live access.

---

## Phase 4: Database Health & Migration Checks

- [ ] **Database Connectivity**: Execute `npm run db:check`.
  - [ ] Verifies database health is `ok`.
  - [ ] Confirms table row counts.
  - [ ] Confirms at least one active staff account with `OWNER` role exists.
  - [ ] Confirms the next expected bill number.
- [ ] **Schema Backward Compatibility**:
  - [ ] Verify that any new database columns have default values or are nullable.
  - [ ] Verify that no existing database columns were deleted or renamed.
  - [ ] Confirm that `meta.order_sequence` is untouched.
- [ ] **Manual Database Backup**:
  - [ ] Verify daily backup status in Supabase Dashboard (**Database → Backups**).
  - [ ] (Optional) Download a JSON data snapshot from the app via **Stock & Management → Settings → Export**.

---

## Phase 5: Deployment Execution

- [ ] **Deploy Application**:
  - If deploying to Render: Trigger deployment via git push or manual deploy in dashboard.
  - If deploying to self-hosted server: Run `git pull && npm ci && npm run build && npm start`.
- [ ] **Liveness Probe Verification**: Check the health endpoint:
  ```bash
  curl -f http://<host>:<port>/api/health
  ```
  Expected: HTTP 200 with `{ "data": { "ok": true } }`.

---

## Phase 6: Post-Deployment Smoke Testing

Perform manual verification on a desktop and mobile device:
- [ ] **Sign In**: Log in using the owner account credentials.
- [ ] **Store Status Banner**: Verify the top bar indicates `Online database (Supabase Postgres)`.
- [ ] **Stock PIN Unlock**: Navigate to **JMR — STOCK** or tap the hidden figures on the dashboard. Enter `STOCK_PIN` and confirm unlock succeeds.
- [ ] **Bill Creation**:
  - [ ] Create a test repair order with customer name and mobile number.
  - [ ] Verify bill ID increments sequentially (`JMR-xxxx`).
  - [ ] Confirm order appears on the dashboard and in the All Bills list.
- [ ] **Bill PDF Generation**:
  - [ ] Open the created order and tap **Print Bill** or download the PDF.
  - [ ] Verify A5 PDF opens and renders shop name, customer info, and pricing.
- [ ] **Payment Recording**: Add a partial or full payment and verify balance calculation updates automatically.
- [ ] **Audit Log Verification**: Check **Stock & Management → Device Logs** and verify the login and bill creation events were recorded.

---

## Phase 7: Rollback Readiness & Sign-Off

- [ ] **Rollback Target Identified**: Note the previous git commit hash or previous deploy ID in hosting dashboard.
- [ ] **No Error Loops in Logs**: Inspect server stdout/stderr logs for unhandled rejections or continuous database reconnection loops.
- [ ] **Client Cache Cleanliness**: Ensure mobile devices load the new version without requiring manual browser data clearing.
- [ ] **Release Completed**: Mark release as successful and notify staff.
