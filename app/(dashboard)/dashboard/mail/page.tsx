import { redirect } from 'next/navigation';
import { Mail } from 'lucide-react';
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
    <section className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-sky-700" />
          <h2 className="text-sm font-semibold text-slate-900">Mail Workspace</h2>
        </div>
        <p className="mt-1 text-xs text-slate-600">Mail proje ekrani dogrudan bu dashboard sayfasina baglidir.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <MailWorkspaceFrame workspaceUrl={workspaceUrl} />
      </div>
    </section>
  );
}
