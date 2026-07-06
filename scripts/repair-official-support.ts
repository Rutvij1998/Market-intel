import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const { repairMislabeledSources } = await import('../lib/ingest');
  console.log('[repair-official-support] Starting repair + Reddit comment backfill...');
  await repairMislabeledSources();
  console.log('[repair-official-support] Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});