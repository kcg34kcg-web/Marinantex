import { OfficeDashboard } from '@/components/office/office-dashboard';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';

interface OfficePageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function OfficePage({ searchParams }: OfficePageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=%2Foffice');
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();

  const activeRole = profile?.role === 'assistant' ? 'assistant' : profile?.role === 'lawyer' ? 'lawyer' : null;

  if (!activeRole) {
    redirect('/dashboard');
  }

  const initialTab =
    params.tab === 'team' || params.tab === 'documents' || params.tab === 'hmk' || params.tab === 'notifications' || params.tab === 'feed'
      ? params.tab
      : undefined;

  return <OfficeDashboard activeRole={activeRole} initialTab={initialTab} />;
}
