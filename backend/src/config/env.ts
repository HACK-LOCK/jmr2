import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Repo root detection. Walks up from this file until it finds the `shared`
 * folder, so the same code works when running from `src/` with tsx and from
 * `dist/` after a build.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'shared', 'domain.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, '..', '..');
}

const repoRoot = findRepoRoot(__dirname);

dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function str(key: string, fallback = ''): string {
  const raw = process.env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(key: string): string[] {
  return str(key)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const rootDir = repoRoot;
const dataDir = path.resolve(rootDir, str('DATA_DIR', path.join('backend', '.data')));

function looksLikeServiceAccount(file: string): boolean {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return false;
    const json = parsed as Record<string, unknown>;
    return (
      json['type'] === 'service_account' &&
      typeof json['client_email'] === 'string' &&
      typeof json['private_key'] === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * The key file is often saved from the Google Cloud console under whatever name
 * the owner typed. Instead of failing silently we look through backend/ for any
 * JSON file that really is a service account key, so the connection works no
 * matter what the file is called.
 */
function discoverServiceAccountFile(): string | undefined {
  const dir = path.join(rootDir, 'backend');
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const skip = new Set(['package.json', 'tsconfig.json', 'tsconfig.build.json']);
  for (const name of entries.sort()) {
    if (skip.has(name.toLowerCase())) continue;
    if (!name.toLowerCase().endsWith('.json')) continue;
    const full = path.join(dir, name);
    if (looksLikeServiceAccount(full)) return full;
  }
  return undefined;
}

function serviceAccountFile(): string | undefined {
  const configured = str('GOOGLE_SERVICE_ACCOUNT_FILE');
  if (configured) {
    const absolute = path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured);
    if (fs.existsSync(absolute) && looksLikeServiceAccount(absolute)) return absolute;
  }
  return discoverServiceAccountFile();
}

function serviceAccountInline(): Record<string, unknown> | undefined {
  const raw = str('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return undefined;
  } catch {
    console.warn('[env] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON - Google integration disabled.');
    return undefined;
  }
}

const credentials = serviceAccountInline();
const credentialsFile = serviceAccountFile();

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  port: num('PORT', 4000),

  rootDir,
  dataDir,
  frontendDist: path.resolve(rootDir, 'frontend', 'dist'),

  jwtSecret: str('JWT_SECRET', 'insecure-dev-secret-change-me'),
  corsOrigins: list('CORS_ORIGINS'),

  supabase: {
    url: bool('SUPABASE_DISABLED', false)
      ? ''
      : str('SUPABASE_URL', str('VITE_SUPABASE_URL', 'https://uvyszkdszzadoycbmeiy.supabase.co')),
    publishableKey: bool('SUPABASE_DISABLED', false)
      ? ''
      : str(
          'SUPABASE_PUBLISHABLE_KEY',
          str('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_WQ_usqzwALohMMj4D5VE4A_jvIxvI6g'),
        ),
  },

  /**
   * The online store. When a connection string is present this database - not
   * Google Sheets - holds the bills, and the app refuses to start if it cannot
   * be reached, so a bill is never quietly written somewhere else.
   */
  database: {
    url: str('DATABASE_URL'),
    /** Only used by the one-time setup script, never by the running app. */
    adminUrl: str('POSTGRES_ADMIN_URL'),
    /** Small shop, small pool. Each Postgres connection costs 1-3MB of RAM. */
    poolMax: num('DATABASE_POOL_MAX', 10),
    /**
     * How often a screen left open on the counter re-reads the shop, in
     * milliseconds. Two seconds is short enough that a bill taken on the other
     * phone appears without anyone tapping refresh, and long enough that an
     * ordinary reading of the app costs almost nothing.
     *
     * 0 turns it off, which is the right setting for a single till.
     */
    refreshMs: num('DB_REFRESH_MS', 2000),
  },

  /**
   * Whether the shop's records are also copied into a Google spreadsheet.
   *
   * The spreadsheet only ever receives; it is a report copy for reading in
   * Excel, never a place to change a bill. Turn this off to run the database on
   * its own, which also saves the Google API calls the copy would make.
   */
  sheetsMirror: bool('SHEETS_MIRROR', true),

  google: {
    sheetsId: str('GOOGLE_SHEETS_ID'),
    driveRootFolderId: str('GOOGLE_DRIVE_ROOT_FOLDER_ID'),
    credentials,
    credentialsFile,
    impersonateUser: str('GOOGLE_IMPERSONATE_USER'),
  },

  allowNegativeStock: bool('ALLOW_NEGATIVE_STOCK', false),

  /**
   * The PIN that opens the Stock area on top of the login. Leave it empty and
   * the app accepts the signed in person's own account password instead, so
   * there is never a shared PIN written into the code.
   */
  stockPin: str('STOCK_PIN'),
  /** How long one stock unlock lasts before the PIN is asked again. */
  stockPinTtlMinutes: num('STOCK_PIN_TTL_MINUTES', 120),
  /** Wrong PIN attempts before the PIN is blocked for a few minutes. */
  stockPinMaxAttempts: num('STOCK_PIN_MAX_ATTEMPTS', 5),

  owner: {
    name: str('OWNER_NAME', 'Ashok Bhai'),
    username: str('OWNER_USERNAME', 'ashok'),
    /**
     * The development default, used when there is no database.
     *
     * Read this only for the local file store. A real shop's password is chosen
     * by the person, not shipped in the code, so the setup script looks at
     * `passwordGiven` and generates one when it is blank.
     */
    password: str('OWNER_PASSWORD', 'shop1234'),
    /** True only when OWNER_PASSWORD was actually filled in. */
    passwordGiven: str('OWNER_PASSWORD') !== '',
  },
} as const;
