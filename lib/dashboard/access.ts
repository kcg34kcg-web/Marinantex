import type { SupabaseClient } from '@supabase/supabase-js';
import type { InternalOfficeRole } from '@/lib/office/team-access';

interface CaseOwnerRow {
  id: string;
  lawyer_id: string;
}

export async function canAccessCase(
  supabase: SupabaseClient,
  input: {
    caseId: string;
    userId: string;
    role: InternalOfficeRole;
  },
): Promise<boolean> {
  if (input.role === 'assistant') {
    return true;
  }

  const { data, error } = await supabase
    .from('cases')
    .select('id, lawyer_id')
    .eq('id', input.caseId)
    .maybeSingle<CaseOwnerRow>();

  if (error || !data) {
    return false;
  }

  return data.lawyer_id === input.userId;
}

