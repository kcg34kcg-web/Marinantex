/* eslint-disable no-console */
import process from 'node:process';

const webBaseUrl = (process.env.WEB_BASE_URL || process.env.PORTAL_SMOKE_WEB_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const authCookie = process.env.PORTAL_SMOKE_AUTH_COOKIE || '';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectStatus(label, response, expectedStatuses) {
  const expected = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  if (!expected.includes(response.status)) {
    const body = await response.text();
    throw new Error(`${label} failed: expected ${expected.join('/')}, got ${response.status}, body=${body.slice(0, 300)}`);
  }
}

async function run() {
  console.log('[portal-smoke] start');
  console.log(`[portal-smoke] webBaseUrl=${webBaseUrl}`);

  const healthResponse = await fetch(`${webBaseUrl}/api/health`);
  await expectStatus('health', healthResponse, 200);
  const healthPayload = await healthResponse.json();
  assert(healthPayload?.status === 'ok', 'health payload not ok');

  const unauthorizedChecks = [
    '/api/portal/cases',
    '/api/portal/hearings?limit=3',
    '/api/portal/notifications?limit=3',
    '/api/portal/sessions',
  ];

  for (const path of unauthorizedChecks) {
    const response = await fetch(`${webBaseUrl}${path}`);
    await expectStatus(`${path} unauthorized`, response, [401, 403]);
  }

  if (!authCookie) {
    console.log('[portal-smoke] authorized checks skipped (set PORTAL_SMOKE_AUTH_COOKIE).');
    console.log('[portal-smoke] passed');
    return;
  }

  const headers = { cookie: authCookie };
  const authorizedChecks = [
    '/api/portal/cases',
    '/api/portal/hearings?limit=3',
    '/api/portal/notifications?limit=3',
    '/api/portal/sessions',
  ];

  for (const path of authorizedChecks) {
    const response = await fetch(`${webBaseUrl}${path}`, { headers });
    await expectStatus(`${path} authorized`, response, 200);
  }

  console.log('[portal-smoke] passed');
}

run().catch((error) => {
  console.error('[portal-smoke] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

