import { PortalCasesList } from '@/components/portal/portal-cases-list';
import { PortalAnnouncements } from '@/components/portal/portal-announcements';
import { requirePortalTwoFactor } from '@/lib/portal/two-factor';

export default async function PortalPage() {
  await requirePortalTwoFactor('/portal');
  return (
    <div className="space-y-4">
      <PortalAnnouncements />
      <PortalCasesList />
    </div>
  );
}
