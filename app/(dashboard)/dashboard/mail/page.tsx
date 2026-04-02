import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { MailWorkspaceFrame } from '@/components/dashboard/mail-workspace-frame';

export default async function DashboardMailPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=%2Fdashboard%2Fmail');
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const activeRole = profile?.role === 'assistant' ? 'assistant' : profile?.role === 'lawyer' ? 'lawyer' : null;

  if (!activeRole) {
    redirect('/dashboard');
  }

  const tenantSlug =
    process.env.MAIL_WORKSPACE_TENANT_SLUG?.trim() ||
    process.env.NEXT_PUBLIC_MAIL_WORKSPACE_TENANT_SLUG?.trim() ||
    'demo-hukuk';
  const workspaceUrl = `/mail-workspace/${encodeURIComponent(tenantSlug)}/mail`;

  return (
    <section className="min-h-screen w-full bg-white">
      <MailWorkspaceFrame workspaceUrl={workspaceUrl} className="h-screen min-h-screen w-full rounded-none border-0 bg-white" />
    </section>
  );
}
