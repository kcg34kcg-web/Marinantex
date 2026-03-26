import type { SupabaseClient } from '@supabase/supabase-js';

interface ProfileRow {
  id: string;
  bureau_id: string | null;
}

interface ClientAccessRow {
  id: string;
  profile_id: string | null;
  created_by: string | null;
}

export interface InternalUserBureauScope {
  bureauId: string;
  bureauProfileIds: string[];
}

async function resolveActorBureauId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, bureau_id')
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (error || !data?.bureau_id) {
    return null;
  }

  return data.bureau_id;
}

export async function resolveInternalUserBureauScope(
  supabase: SupabaseClient,
  userId: string,
): Promise<InternalUserBureauScope | null> {
  const bureauId = await resolveActorBureauId(supabase, userId);
  if (!bureauId) {
    return null;
  }

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('bureau_id', bureauId)
    .limit(2000);

  if (profileError) {
    return null;
  }

  return {
    bureauId,
    bureauProfileIds: (profileRows ?? []).map((row) => row.id),
  };
}

export async function resolveAccessibleClientIds(
  supabase: SupabaseClient,
  input: {
    clientIds: string[];
    bureauId: string;
    bureauProfileIds: string[];
  },
): Promise<Set<string>> {
  const candidateClientIds = [...new Set(input.clientIds.filter(Boolean))];
  const allowedClientIds = new Set<string>();
  if (candidateClientIds.length === 0) {
    return allowedClientIds;
  }

  const profileIdSet = new Set(input.bureauProfileIds);

  const { data: clientRows, error: clientsError } = await supabase
    .from('clients')
    .select('id, profile_id, created_by')
    .in('id', candidateClientIds)
    .is('deleted_at', null);

  if (clientsError) {
    return allowedClientIds;
  }

  const clientRowById = new Map<string, { profile_id: string | null; created_by: string | null }>();
  for (const row of clientRows ?? []) {
    clientRowById.set(row.id, {
      profile_id: row.profile_id,
      created_by: row.created_by,
    });

    if (
      (typeof row.profile_id === 'string' && profileIdSet.has(row.profile_id))
      || (typeof row.created_by === 'string' && profileIdSet.has(row.created_by))
    ) {
      allowedClientIds.add(row.id);
    }
  }

  const unresolvedIds = candidateClientIds.filter((id) => !allowedClientIds.has(id));
  if (unresolvedIds.length > 0) {
    const linksResult = await supabase
      .from('case_clients')
      .select('case_id, client_id')
      .in('client_id', unresolvedIds)
      .is('deleted_at', null);

    if (!linksResult.error) {
      const caseIds = [...new Set((linksResult.data ?? []).map((row) => row.case_id))];
      if (caseIds.length > 0) {
        const casesResult = await supabase
          .from('cases')
          .select('id')
          .in('id', caseIds)
          .eq('bureau_id', input.bureauId);

        if (!casesResult.error) {
          const bureauCaseIds = new Set((casesResult.data ?? []).map((row) => row.id));
          for (const row of linksResult.data ?? []) {
            if (bureauCaseIds.has(row.case_id)) {
              allowedClientIds.add(row.client_id);
            }
          }
        }
      }
    }
  }

  const legacyUnresolvedIds = candidateClientIds.filter((id) => !allowedClientIds.has(id));
  if (legacyUnresolvedIds.length > 0) {
    const legacyProfileToClientId = new Map<string, string>();
    for (const clientId of legacyUnresolvedIds) {
      const candidate = clientRowById.get(clientId);
      if (candidate?.profile_id) {
        legacyProfileToClientId.set(candidate.profile_id, clientId);
      }
    }

    const profileIds = [...legacyProfileToClientId.keys()];
    if (profileIds.length > 0) {
      const legacyCasesResult = await supabase
        .from('cases')
        .select('client_id')
        .in('client_id', profileIds)
        .eq('bureau_id', input.bureauId);

      if (!legacyCasesResult.error) {
        for (const row of legacyCasesResult.data ?? []) {
          if (typeof row.client_id !== 'string') {
            continue;
          }
          const clientId = legacyProfileToClientId.get(row.client_id);
          if (clientId) {
            allowedClientIds.add(clientId);
          }
        }
      }
    }
  }

  return allowedClientIds;
}

async function matchesBureauViaProfiles(
  supabase: SupabaseClient,
  actorBureauId: string,
  profileIds: string[],
): Promise<boolean> {
  if (profileIds.length === 0) {
    return false;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, bureau_id')
    .in('id', profileIds);

  if (error) {
    return false;
  }

  return (data ?? []).some((row) => row.bureau_id === actorBureauId);
}

async function matchesBureauViaCaseLinks(
  supabase: SupabaseClient,
  actorBureauId: string,
  clientId: string,
  clientProfileId: string | null,
): Promise<boolean> {
  const linksResult = await supabase
    .from('case_clients')
    .select('case_id')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .limit(200);

  if (!linksResult.error) {
    const caseIds = [...new Set((linksResult.data ?? []).map((row) => row.case_id))];
    if (caseIds.length > 0) {
      const { data, error } = await supabase
        .from('cases')
        .select('id')
        .in('id', caseIds)
        .eq('bureau_id', actorBureauId)
        .limit(1);

      if (!error && (data ?? []).length > 0) {
        return true;
      }
    }
  }

  // Legacy fallback: older rows may only be tied with cases.client_id = profiles.id.
  if (clientProfileId) {
    const legacyResult = await supabase
      .from('cases')
      .select('id')
      .eq('client_id', clientProfileId)
      .eq('bureau_id', actorBureauId)
      .limit(1);

    if (!legacyResult.error && (legacyResult.data ?? []).length > 0) {
      return true;
    }
  }

  return false;
}

export async function canAccessClient(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    userId: string;
  },
): Promise<boolean> {
  const actorBureauId = await resolveActorBureauId(supabase, input.userId);
  if (!actorBureauId) {
    return false;
  }

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, profile_id, created_by')
    .eq('id', input.clientId)
    .is('deleted_at', null)
    .maybeSingle<ClientAccessRow>();

  if (clientError || !client) {
    return false;
  }

  const profileCandidates = [client.profile_id, client.created_by].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  if (await matchesBureauViaProfiles(supabase, actorBureauId, profileCandidates)) {
    return true;
  }

  return matchesBureauViaCaseLinks(
    supabase,
    actorBureauId,
    client.id,
    client.profile_id,
  );
}
