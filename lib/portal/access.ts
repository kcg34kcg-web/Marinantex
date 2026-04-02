import { cookies } from 'next/headers';
import { createAdminClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';
import { getPortalSessionCookies, validatePortalAccessSession } from '@/lib/portal/session';

interface PortalClientProfileRow {
  role: string;
  bureau_id: string | null;
}

interface PortalClientRow {
  id: string;
  status: string;
}

interface PortalCaseRow {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed' | 'archived';
  updated_at: string;
  bureau_id: string | null;
  file_no: string | null;
  client_id: string | null;
}

interface PortalCaseLinkRow {
  case_id: string;
  public_ref_code: string;
  cases: PortalCaseRow | PortalCaseRow[] | null;
}

export interface PortalClientContext {
  userId: string;
  bureauId: string;
  clientId: string;
  sessionId?: string;
  deviceId?: string;
  sessionPersisted?: boolean;
}

export interface PortalAccessibleCase {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed' | 'archived';
  updatedAt: string;
  fileNo: string | null;
  visibilityMode: 'many_to_many' | 'legacy_direct';
}

type PortalClientAccessResult =
  | {
      ok: true;
      context: PortalClientContext;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

function normalizeJoinedCase(input: PortalCaseRow | PortalCaseRow[] | null): PortalCaseRow | null {
  if (!input) {
    return null;
  }

  return Array.isArray(input) ? (input[0] ?? null) : input;
}

export async function requirePortalClientAccess(options?: {
  requireTwoFactor?: boolean;
}): Promise<PortalClientAccessResult> {
  const requireTwoFactor = Boolean(options?.requireTwoFactor);
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, status: 401, message: 'Portal oturumu doğrulanamadı.' };
  }

  const profileResult = await supabase.from('profiles').select('role, bureau_id').eq('id', user.id).maybeSingle();
  const profile = (profileResult.data ?? null) as PortalClientProfileRow | null;

  if (profileResult.error || !profile) {
    return { ok: false, status: 403, message: 'Portal profili doğrulanamadı.' };
  }

  if (profile.role !== 'client') {
    return { ok: false, status: 403, message: 'Bu alan yalnızca müvekkil hesabına açıktır.' };
  }

  if (!profile.bureau_id) {
    return { ok: false, status: 403, message: 'Tenant kapsamı doğrulanamadı.' };
  }

  let sessionContext:
    | {
        sessionId?: string;
        deviceId?: string;
        sessionPersisted?: boolean;
      }
    | undefined;

  if (requireTwoFactor) {
    const cookieStore = await cookies();
    const twoFactorVerified = cookieStore.get('portal_2fa_verified')?.value === 'true';
    const enforceJwtSession = process.env.PORTAL_ENFORCE_SESSION_JWT !== 'false';

    if (!twoFactorVerified) {
      return { ok: false, status: 403, message: 'İki adımlı doğrulama zorunludur.' };
    }

    const sessionCookies = getPortalSessionCookies(cookieStore);
    if (sessionCookies.accessToken) {
      try {
        const validated = await validatePortalAccessSession({
          accessToken: sessionCookies.accessToken,
          expectedUserId: user.id,
          expectedTenantId: profile.bureau_id,
        });

        if (validated.valid) {
          sessionContext = {
            sessionId: validated.sessionId,
            deviceId: validated.deviceId,
            sessionPersisted: validated.persisted,
          };
        } else if (enforceJwtSession) {
          return { ok: false, status: 401, message: 'Portal oturumu yenilenmeli.' };
        }
      } catch {
        if (enforceJwtSession) {
          return { ok: false, status: 401, message: 'Portal oturum doğrulaması başarısız.' };
        }
      }
    } else if (enforceJwtSession) {
      return { ok: false, status: 401, message: 'Portal oturumu yenilenmeli.' };
    }
  }

  const admin = createAdminClient();
  const clientResult = await admin
    .from('clients')
    .select('id, status')
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();
  const client = (clientResult.data ?? null) as PortalClientRow | null;

  if (clientResult.error || !client) {
    return { ok: false, status: 403, message: 'Müvekkil kaydı doğrulanamadı.' };
  }

  if (client.status === 'inactive') {
    return { ok: false, status: 403, message: 'Müvekkil hesabı pasif durumda.' };
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      bureauId: profile.bureau_id,
      clientId: client.id,
      sessionId: sessionContext?.sessionId,
      deviceId: sessionContext?.deviceId,
      sessionPersisted: sessionContext?.sessionPersisted,
    },
  };
}

export async function resolvePortalCaseAccess(input: {
  caseId: string;
  clientId: string;
  profileUserId: string;
  bureauId: string;
}): Promise<PortalCaseRow | null> {
  const admin = createAdminClient();

  const linkedResult = await admin
    .from('case_clients')
    .select('case_id, public_ref_code, cases!inner(id, title, status, updated_at, bureau_id, file_no, client_id)')
    .eq('case_id', input.caseId)
    .eq('client_id', input.clientId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!linkedResult.error && linkedResult.data) {
    const linkedRow = linkedResult.data as PortalCaseLinkRow;
    const linkedCase = normalizeJoinedCase(linkedRow.cases);
    if (linkedCase && linkedCase.bureau_id === input.bureauId) {
      return linkedCase;
    }
  }

  const legacyResult = await admin
    .from('cases')
    .select('id, title, status, updated_at, bureau_id, file_no, client_id')
    .eq('id', input.caseId)
    .maybeSingle();
  const legacyCase = (legacyResult.data ?? null) as PortalCaseRow | null;

  if (legacyResult.error || !legacyCase) {
    return null;
  }

  if (legacyCase.bureau_id !== input.bureauId) {
    return null;
  }

  if (legacyCase.client_id !== input.profileUserId) {
    return null;
  }

  return legacyCase;
}

export async function listPortalAccessibleCases(input: {
  bureauId: string;
  clientId: string;
  profileUserId: string;
}): Promise<PortalAccessibleCase[]> {
  const admin = createAdminClient();
  const [linkedCasesResult, legacyCasesResult] = await Promise.all([
    admin
      .from('case_clients')
      .select('case_id, public_ref_code, cases!inner(id, title, status, updated_at, bureau_id, file_no)')
      .eq('client_id', input.clientId)
      .is('deleted_at', null),
    admin
      .from('cases')
      .select('id, title, status, updated_at, bureau_id, file_no, client_id')
      .eq('client_id', input.profileUserId),
  ]);

  if (legacyCasesResult.error) {
    throw legacyCasesResult.error;
  }

  if (linkedCasesResult.error && linkedCasesResult.error.code !== '42P01') {
    throw linkedCasesResult.error;
  }

  const byCaseId = new Map<string, PortalAccessibleCase>();

  const linkedRows = (linkedCasesResult.data ?? []) as PortalCaseLinkRow[];
  linkedRows.forEach((row) => {
    const caseRow = normalizeJoinedCase(row.cases);
    if (!caseRow || caseRow.bureau_id !== input.bureauId) {
      return;
    }

    byCaseId.set(caseRow.id, {
      id: caseRow.id,
      title: caseRow.title,
      status: caseRow.status,
      updatedAt: caseRow.updated_at,
      fileNo: caseRow.file_no,
      visibilityMode: 'many_to_many',
    });
  });

  const legacyRows = (legacyCasesResult.data ?? []) as Array<PortalCaseRow & { client_id: string | null }>;
  legacyRows.forEach((row) => {
    if (row.bureau_id !== input.bureauId) {
      return;
    }

    if (!byCaseId.has(row.id)) {
      byCaseId.set(row.id, {
        id: row.id,
        title: row.title,
        status: row.status,
        updatedAt: row.updated_at,
        fileNo: row.file_no,
        visibilityMode: 'legacy_direct',
      });
    }
  });

  return [...byCaseId.values()].sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
