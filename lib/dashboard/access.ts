import type { SupabaseClient } from '@supabase/supabase-js';
import type { InternalOfficeRole } from '@/lib/office/team-access';
import { resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';

interface CaseOwnerRow {
  id: string;
  lawyer_id: string;
  bureau_id?: string | null;
}

export async function canAccessCase(
  supabase: SupabaseClient,
  input: {
    caseId: string;
    userId: string;
    role: InternalOfficeRole;
  },
): Promise<boolean> {
  const caseWithBureauResult = await supabase
    .from('cases')
    .select('id, lawyer_id, bureau_id')
    .eq('id', input.caseId)
    .maybeSingle<CaseOwnerRow>();

  const caseResult =
    caseWithBureauResult.error?.code === '42703'
      ? await supabase
          .from('cases')
          .select('id, lawyer_id')
          .eq('id', input.caseId)
          .maybeSingle<CaseOwnerRow>()
      : caseWithBureauResult;

  if (caseResult.error || !caseResult.data) {
    return false;
  }

  if (input.role === 'lawyer') {
    return caseResult.data.lawyer_id === input.userId;
  }

  const scope = await resolveInternalUserBureauScope(supabase, input.userId);
  if (!scope) {
    return false;
  }

  if (caseResult.data.bureau_id) {
    return caseResult.data.bureau_id === scope.bureauId;
  }

  return scope.bureauProfileIds.includes(caseResult.data.lawyer_id);
}

