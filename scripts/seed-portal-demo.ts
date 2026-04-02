/* eslint-disable no-console */
import { seedPortalDemoDataset } from '@/lib/portal/demo-seed';

async function main() {
  const seeded = await seedPortalDemoDataset({
    preferredLawyerId: process.env.PORTAL_DEMO_LAWYER_ID ?? null,
    preferredTenantId: process.env.PORTAL_DEMO_TENANT_ID ?? null,
    demoClientEmail: process.env.PORTAL_DEMO_CLIENT_EMAIL ?? null,
    demoClientName: process.env.PORTAL_DEMO_CLIENT_NAME ?? null,
  });

  console.log('portal-demo-seed-complete');
  console.log(JSON.stringify(seeded, null, 2));
}

main().catch((error) => {
  console.error('portal-demo-seed-failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

