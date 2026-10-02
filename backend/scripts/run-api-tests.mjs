/**
 * Runs the API test suites against a throwaway server.
 *
 * The suites create real bills, items, suppliers and stock movements, so
 * pointing them at the shop's own server quietly fills the real data file with
 * test records. This starts a second server on its own port with DATA_DIR in a
 * temp folder, runs everything there, and deletes the folder afterwards - so
 * `npm test` can be run at any time without touching the shop's data.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const serverEntry = path.join(repoRoot, 'backend', 'dist', 'backend', 'src', 'index.js');
const dataDir = path.join(os.tmpdir(), 'jmmr-api-test-data');
const shopData = path.join(repoRoot, 'backend', '.data', 'shop-data.json');

const SUITES = [
  { name: 'smoke', file: path.join(here, 'smoke.mjs') },
  { name: 'e2e', file: path.join(here, 'e2e.mjs') },
];

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/**
 * How to rebuild the backend without going through a shell.
 *
 * Spawning "npm" or "npm.cmd" here is not portable: bare "npm" is ENOENT on
 * Windows, and current Node refuses to spawn a .cmd at all without a shell
 * (EINVAL), so the build step simply could not run. Running the project's own
 * tsc through `node` avoids both problems and is the same compiler and the same
 * tsconfig that `npm run build --workspace backend` uses.
 */
const TSC = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const BACKEND_TSCONFIG = path.join(repoRoot, 'backend', 'tsconfig.build.json');

/**
 * The PIN the throwaway server is given. It belongs to the test run only, so the
 * checks neither read nor print the PIN the shop actually uses.
 */
const TEST_PIN = '2468';

function isFree(port) {  return new Promise((resolve) => {
    const probe = spawn(
      process.execPath,
      ['-e', `const n=require('net');const s=n.createServer();s.once('error',()=>process.exit(1));s.listen(${port},'127.0.0.1',()=>s.close(()=>process.exit(0)));`],
      { stdio: 'ignore' },
    );
    probe.on('close', (code) => resolve(code === 0));
  });
}

async function pickPort() {
  const first = Number(process.env.TEST_PORT ?? 4100);
  for (let port = first; port < first + 10; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port between ${first} and ${first + 9}. Set TEST_PORT to something else.`);
}

async function waitForHealth(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureBuilt() {
  // Always rebuild. This used to build only when dist was missing, which meant a
  // second run of `npm test` after an edit tested the PREVIOUS build and passed
  // while proving nothing about the change just made. A test run that can report
  // success against old code is worse than no test run at all, because it looks
  // like the change was verified. A few seconds of build is a cheap price for
  // knowing the suites ran against what is actually in the source tree.
  console.log('Building the backend, so the suites run against the current source...');
  const code = await run(process.execPath, [TSC, '-p', BACKEND_TSCONFIG], { cwd: repoRoot });
  if (code !== 0 || !fs.existsSync(serverEntry)) {
    throw new Error('Backend build failed, so the tests cannot run.');
  }
}

function cleanDataDir() {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

/**
 * Fingerprint of the shop's own data file. The suites create real records, so
 * this is checked before and after: if the shop data moves at all, something
 * reached the wrong server and that must fail loudly rather than quietly fill
 * the shop's books with test bills.
 */
function shopFingerprint() {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(shopData)).digest('hex');
  } catch {
    return 'missing';
  }
}

async function main() {
  await ensureBuilt();
  cleanDataDir();

  const port = await pickPort();
  console.log(`\nTest server on port ${port}, data directory ${dataDir}`);
  console.log('The shop data in backend/.data is not involved.\n');

  const server = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATA_DIR: dataDir,
      // The single most important line in this file.
      //
      // The server reads .env from the repo root on startup, and dotenv does not
      // overwrite a variable that is already set. Blanking the database here is
      // therefore what stops `npm test` from connecting to the shop's real
      // Supabase project and writing test bills into it. Same for the admin
      // connection, which must never travel with a test run at all.
      DATABASE_URL: '',
      POSTGRES_ADMIN_URL: '',
      SUPABASE_DISABLED: 'true',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      // Sheets and Drive stay out of it: no test should talk to the real sheet.
      GOOGLE_SHEETS_ID: '',
      GOOGLE_DRIVE_ROOT_FOLDER_ID: '',
      GOOGLE_SERVICE_ACCOUNT_JSON: '',
      GOOGLE_SERVICE_ACCOUNT_FILE: '',
      // Belt and braces: even if a key were found, no copy would be attempted.
      SHEETS_MIRROR: 'false',
      // A PIN of the test's own, so the checks never depend on - or print -
      // whatever the shop has set in .env.
      STOCK_PIN: TEST_PIN,
      // A token key of the test's own, so no test token is signed with the
      // secret the shop runs on.
      JWT_SECRET: `test-only-${crypto.randomBytes(16).toString('hex')}`,
    },
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.kill();
  };
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  let failed = false;
  const before = shopFingerprint();
  try {
    if (!(await waitForHealth(port))) {
      throw new Error('The test server did not become healthy within 30 seconds.');
    }

    // Proves DATA_DIR was honoured rather than silently ignored. The store
    // writes the user file at startup, so it is there before any test runs.
    const started = fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0;
    if (!started) {
      throw new Error('The test server did not use the temp data directory - stopping before it can touch shop data.');
    }

    for (const suite of SUITES) {
      console.log(`\n========== ${suite.name} ==========`);
      const code = await run(process.execPath, [suite.file], {
        cwd: repoRoot,
        // API_BASE is the site root, so both suites agree on one variable.
        // STOCK_PIN tells the suite the PIN the throwaway server is using.
        env: {
          ...process.env,
          API_BASE: `http://127.0.0.1:${port}`,
          STOCK_PIN: TEST_PIN,
        },
      });
      if (code !== 0) {
        console.log(`\n${suite.name} failed with exit code ${code}.`);
        failed = true;
        break;
      }
    }
  } catch (error) {
    console.error(`\n${error.message}`);
    failed = true;
  } finally {
    stop();
    // Give the server a moment to release the file before it is deleted.
    await new Promise((resolve) => setTimeout(resolve, 500));
    cleanDataDir();
  }

  if (shopFingerprint() !== before) {
    console.error('\nThe shop data file changed during the test run. Do not trust these results until that is fixed.');
    failed = true;
  } else {
    console.log('\nShop data untouched.');
  }

  process.exit(failed ? 1 : 0);
}

main();
