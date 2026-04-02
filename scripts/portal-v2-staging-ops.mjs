/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
}

function resolveEnv() {
  const cwd = process.cwd();
  readEnvFile(path.join(cwd, '.env.local'));
  readEnvFile(path.join(cwd, '.env'));

  return {
    databaseUrl:
      process.env.PORTAL_STAGING_DATABASE_URL
      || process.env.STAGING_DATABASE_URL
      || '',
    webBaseUrl:
      process.env.PORTAL_STAGING_WEB_BASE_URL
      || process.env.STAGING_WEB_BASE_URL
      || process.env.WEB_BASE_URL
      || '',
    authCookie: process.env.PORTAL_STAGING_AUTH_COOKIE || '',
  };
}

async function applyMigration(databaseUrl) {
  const migrationPath = path.join(process.cwd(), 'supabase', 'portal_v2_step01_enterprise_foundation.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function expectStatuses(label, response, expected) {
  if (!expected.includes(response.status)) {
    throw new Error(`${label} failed: expected ${expected.join('/')}, got ${response.status}`);
  }
}

async function runSmoke(webBaseUrl, authCookie) {
  if (!webBaseUrl) {
    console.log('[portal-v2-staging] smoke skipped: missing PORTAL_STAGING_WEB_BASE_URL/STAGING_WEB_BASE_URL.');
    return;
  }

  const health = await fetch(`${webBaseUrl.replace(/\/$/, '')}/api/health`);
  expectStatuses('web health', health, [200]);

  const unauthorizedPortalCases = await fetch(`${webBaseUrl.replace(/\/$/, '')}/api/portal/cases`);
  expectStatuses('portal cases unauthorized', unauthorizedPortalCases, [401, 403]);

  if (!authCookie) {
    console.log('[portal-v2-staging] authenticated portal smoke skipped: missing PORTAL_STAGING_AUTH_COOKIE.');
    return;
  }

  const withAuthHeaders = { cookie: authCookie };

  const cases = await fetch(`${webBaseUrl.replace(/\/$/, '')}/api/portal/cases`, {
    headers: withAuthHeaders,
  });
  expectStatuses('portal cases authorized', cases, [200]);

  const hearings = await fetch(`${webBaseUrl.replace(/\/$/, '')}/api/portal/hearings?limit=5`, {
    headers: withAuthHeaders,
  });
  expectStatuses('portal hearings authorized', hearings, [200]);

  const notifications = await fetch(`${webBaseUrl.replace(/\/$/, '')}/api/portal/notifications?limit=5`, {
    headers: withAuthHeaders,
  });
  expectStatuses('portal notifications authorized', notifications, [200]);
}

async function main() {
  const env = resolveEnv();

  if (!env.databaseUrl) {
    throw new Error(
      'Missing staging DB URL. Set PORTAL_STAGING_DATABASE_URL or STAGING_DATABASE_URL.',
    );
  }

  console.log('[portal-v2-staging] applying portal_v2_step01_enterprise_foundation.sql');
  await applyMigration(env.databaseUrl);
  console.log('[portal-v2-staging] migration applied');

  console.log('[portal-v2-staging] running endpoint smoke');
  await runSmoke(env.webBaseUrl, env.authCookie);
  console.log('[portal-v2-staging] smoke completed');
}

main().catch((error) => {
  console.error('[portal-v2-staging] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
