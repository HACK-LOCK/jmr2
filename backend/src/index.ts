import dns from 'node:dns';
try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {}

import { createApp } from './app';
import { env } from './config/env';
import { getStore, initStore } from './data';
import { userStore, initUsers } from './data/userStore';
import { isGoogleReady } from './google/client';
import { syncAndRestoreSupabase } from './services/supabaseSync';

function describeStore(): string {
  const store = getStore();
  if (store.mode === 'postgres') {
    return 'online database (Supabase Postgres)';
  }
  if (store.mode === 'sheets') return 'Google Sheets';
  return 'local file on this computer';
}

async function main(): Promise<void> {
  // The store comes first: staff accounts live in the database when there is
  // one, so the connection has to be known before they are opened.
  await initStore();
  await initUsers();

  // Restore bills & stock from Supabase on startup so data is never lost across server restarts
  if (env.supabase.url && env.supabase.publishableKey) {
    void syncAndRestoreSupabase()
      .then((res) => {
        console.log(
          `[supabase] Cloud sync ready: ${res.ordersCount} orders, ${res.partsCount} parts restored/verified.`,
        );
      })
      .catch((err) => {
        console.warn('[supabase] Startup cloud sync notice:', err instanceof Error ? err.message : err);
      });
  }

  const app = createApp();
  app.listen(env.port, () => {
    const mirror = getStore().mode === 'postgres';
    console.log('');
    console.log('  Jai Mataji Mobile Repairing - API');
    console.log(`  Running on  http://localhost:${env.port}`);
    console.log(`  Data store  ${describeStore()}`);
    console.log(`  Staff logins ${userStore.where()}`);
    if (isGoogleReady() && env.google.sheetsId && !mirror) {
      console.log('  Sheets      connected as the store');
    }
    if (env.jwtSecret === 'insecure-dev-secret-change-me') {
      console.log('  ! Set JWT_SECRET in .env before using this on a phone.');
    }
    console.log('');
  });
}

main().catch((error: unknown) => {
  console.error('Could not start the server:', error);
  process.exit(1);
});
