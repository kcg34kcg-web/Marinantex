import { PortalCasesList } from '@/components/portal/portal-cases-list';
import { PortalAnnouncements } from '@/components/portal/portal-announcements';
import { PortalSessionManager } from '@/components/portal/portal-session-manager';
import { PortalNotificationStream } from '@/components/portal/portal-notification-stream';
import { PortalHearingCalendar } from '@/components/portal/portal-hearing-calendar';
import { requirePortalTwoFactor } from '@/lib/portal/two-factor';

export default async function PortalPage() {
  await requirePortalTwoFactor('/portal');
  return (
    <div className="space-y-4">
      <PortalNotificationStream />
      <PortalHearingCalendar />
      <PortalAnnouncements />
      <PortalCasesList />
      <PortalSessionManager />
    </div>
  );
}
