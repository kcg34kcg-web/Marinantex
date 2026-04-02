import { createClient } from '@supabase/supabase-js';

const SEED_MARKER = '[PORTAL_DEMO_V2]';

function createPortalSeedAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!url || !key) {
    throw new Error('Supabase admin env eksik. NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY gerekli.');
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

interface SeedCaseDefinition {
  title: string;
  status: 'open' | 'in_progress' | 'closed' | 'archived';
  fileNo: string;
  updateMessage: string;
  hearingTitle: string;
  hearingDescription: string;
  hearingAtIso: string;
  courtName: string;
  documentName: string;
  documentText: string;
}

function addDays(days: number) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  now.setHours(10, 0, 0, 0);
  return now.toISOString();
}

function normalizeStatus(value: unknown): 'open' | 'in_progress' | 'closed' | 'archived' {
  if (value === 'open' || value === 'in_progress' || value === 'closed' || value === 'archived') {
    return value;
  }
  return 'open';
}

function isMissingColumnError(error: unknown) {
  const code = (error as { code?: string } | null | undefined)?.code;
  return code === '42703' || code === 'PGRST204';
}

function buildCaseDefinitions(): SeedCaseDefinition[] {
  return [
    {
      title: 'Demo Portal Dosyası - İşe İade',
      status: 'in_progress',
      fileNo: '2026/PORTAL-001',
      updateMessage:
        'Mahkeme tensip zaptı paylaşıldı. Bir sonraki adım: tanık listesi netleştirme ve delil klasörü güncellemesi.',
      hearingTitle: 'Ön İnceleme Duruşması',
      hearingDescription: 'Taraf beyanları ve delil listesi değerlendirmesi yapılacaktır.',
      hearingAtIso: addDays(9),
      courtName: 'İstanbul 8. İş Mahkemesi',
      documentName: 'on-inceleme-bilgilendirme.txt',
      documentText:
        'Bu belge demo amaçlıdır. Duruşma öncesi yapılacak hazırlık adımları ve paylaşım planı burada özetlenir.',
    },
    {
      title: 'Demo Portal Dosyası - Kira Alacağı',
      status: 'open',
      fileNo: '2026/PORTAL-002',
      updateMessage:
        'İcra takibi açılış evrakları hazırlandı. Tebligat süreci başlatıldı, karşı taraf savunması bekleniyor.',
      hearingTitle: 'İlk Duruşma',
      hearingDescription: 'Dosya kapsamı, itirazların değerlendirilmesi ve bilirkişi talebi görüşülecek.',
      hearingAtIso: addDays(16),
      courtName: 'İstanbul 12. Sulh Hukuk Mahkemesi',
      documentName: 'icra-sureci-bilgilendirme.txt',
      documentText:
        'Bu belge demo amaçlıdır. Kira alacağı dosyasında güncel safha, riskler ve bir sonraki adımlar açıklanır.',
    },
  ];
}

async function resolveLawyerAndTenant(input?: { preferredLawyerId?: string | null; preferredTenantId?: string | null }) {
  const admin = createPortalSeedAdminClient();
  if (input?.preferredLawyerId && input.preferredTenantId) {
    return {
      lawyerId: input.preferredLawyerId,
      tenantId: input.preferredTenantId,
    };
  }

  const preferredLawyerResult = input?.preferredLawyerId
    ? await admin
        .from('profiles')
        .select('id, bureau_id')
        .eq('id', input.preferredLawyerId)
        .in('role', ['lawyer', 'assistant'])
        .maybeSingle()
    : { data: null, error: null };

  if (!preferredLawyerResult.error && preferredLawyerResult.data?.bureau_id) {
    return {
      lawyerId: preferredLawyerResult.data.id as string,
      tenantId: preferredLawyerResult.data.bureau_id as string,
    };
  }

  const fallbackLawyerResult = await admin
    .from('profiles')
    .select('id, bureau_id, role, created_at')
    .in('role', ['lawyer', 'assistant'])
    .not('bureau_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallbackLawyerResult.error || !fallbackLawyerResult.data?.bureau_id) {
    throw new Error('Demo seed için uygun avukat/tenant bulunamadı.');
  }

  return {
    lawyerId: fallbackLawyerResult.data.id as string,
    tenantId: fallbackLawyerResult.data.bureau_id as string,
  };
}

async function resolveOrCreateDemoClient(input: {
  tenantId: string;
  lawyerId: string;
  demoClientEmail?: string | null;
  demoClientName?: string | null;
}) {
  const admin = createPortalSeedAdminClient();
  const demoClientName = (input.demoClientName?.trim() || 'Demo Müvekkil').slice(0, 120);
  const normalizedEmail = input.demoClientEmail?.trim().toLowerCase() || null;

  if (normalizedEmail) {
    const existingByEmail = await admin
      .from('clients')
      .select('id, full_name, profile_id')
      .eq('email', normalizedEmail)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existingByEmail.error && existingByEmail.data?.id) {
      return {
        clientId: existingByEmail.data.id as string,
        clientName: (existingByEmail.data.full_name as string | null) ?? demoClientName,
        clientProfileId: (existingByEmail.data.profile_id as string | null) ?? null,
      };
    }
  }

  const existingByName = await admin
    .from('clients')
    .select('id, full_name, profile_id')
    .ilike('full_name', `${demoClientName}%`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existingByName.error && existingByName.data?.id) {
    return {
      clientId: existingByName.data.id as string,
      clientName: (existingByName.data.full_name as string | null) ?? demoClientName,
      clientProfileId: (existingByName.data.profile_id as string | null) ?? null,
    };
  }

  const insertResult = await admin
    .from('clients')
    .insert({
      full_name: demoClientName,
      email: normalizedEmail,
      status: 'active',
      created_by: input.lawyerId,
      tenant_id: input.tenantId,
    })
    .select('id, full_name, profile_id')
    .maybeSingle();

  const fallbackInsert =
    isMissingColumnError(insertResult.error)
      ? await admin
          .from('clients')
          .insert({
            full_name: demoClientName,
            email: normalizedEmail,
            created_by: input.lawyerId,
          })
          .select('id, full_name, profile_id')
          .maybeSingle()
      : insertResult;

  const secondFallbackInsert =
    isMissingColumnError(fallbackInsert.error)
      ? await admin
          .from('clients')
          .insert({
            full_name: demoClientName,
            email: normalizedEmail,
          })
          .select('id, full_name, profile_id')
          .maybeSingle()
      : fallbackInsert;

  if (secondFallbackInsert.error || !secondFallbackInsert.data?.id) {
    throw new Error('Demo müvekkil oluşturulamadı.');
  }

  return {
    clientId: secondFallbackInsert.data.id as string,
    clientName: (secondFallbackInsert.data.full_name as string | null) ?? demoClientName,
    clientProfileId: (secondFallbackInsert.data.profile_id as string | null) ?? null,
  };
}

async function resolveOrCreateDemoCase(input: {
  tenantId: string;
  lawyerId: string;
  clientProfileId: string | null;
  caseDef: SeedCaseDefinition;
}) {
  const admin = createPortalSeedAdminClient();

  const existing = await admin
    .from('cases')
    .select('id, status')
    .eq('title', input.caseDef.title)
    .eq('bureau_id', input.tenantId)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    return {
      caseId: existing.data.id as string,
      status: normalizeStatus(existing.data.status),
    };
  }

  const nowIso = new Date().toISOString();
  const insertResult = await admin
    .from('cases')
    .insert({
      title: input.caseDef.title,
      status: input.caseDef.status,
      lawyer_id: input.lawyerId,
      client_id: input.clientProfileId,
      bureau_id: input.tenantId,
      file_no: input.caseDef.fileNo,
      tenant_id: input.tenantId,
      updated_at: nowIso,
    })
    .select('id, status')
    .maybeSingle();

  const fallbackInsert =
    isMissingColumnError(insertResult.error)
      ? await admin
          .from('cases')
          .insert({
            title: input.caseDef.title,
            status: input.caseDef.status,
            lawyer_id: input.lawyerId,
            client_id: input.clientProfileId,
            bureau_id: input.tenantId,
            updated_at: nowIso,
          })
          .select('id, status')
          .maybeSingle()
      : insertResult;

  if (fallbackInsert.error || !fallbackInsert.data?.id) {
    throw new Error(`Demo dava oluşturulamadı: ${input.caseDef.title}`);
  }

  return {
    caseId: fallbackInsert.data.id as string,
    status: normalizeStatus(fallbackInsert.data.status),
  };
}

async function ensureCaseClientLink(input: { caseId: string; clientId: string; tenantId: string; lawyerId: string }) {
  const admin = createPortalSeedAdminClient();
  const upsertResult = await admin.from('case_clients').upsert(
    {
      case_id: input.caseId,
      client_id: input.clientId,
      tenant_id: input.tenantId,
      created_by: input.lawyerId,
    },
    {
      onConflict: 'case_id,client_id',
      ignoreDuplicates: false,
    },
  );

  if (upsertResult.error && isMissingColumnError(upsertResult.error)) {
    await admin.from('case_clients').upsert(
      {
        case_id: input.caseId,
        client_id: input.clientId,
      },
      {
        onConflict: 'case_id,client_id',
        ignoreDuplicates: false,
      },
    );
  }
}

async function ensureCaseUpdate(input: { caseId: string; message: string; lawyerId: string; tenantId: string }) {
  const admin = createPortalSeedAdminClient();
  const markerMessage = `${SEED_MARKER} ${input.message}`;
  const existing = await admin
    .from('case_updates')
    .select('id')
    .eq('case_id', input.caseId)
    .ilike('message', `${SEED_MARKER}%`)
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    return;
  }

  const insertResult = await admin.from('case_updates').insert({
    case_id: input.caseId,
    message: markerMessage,
    is_public_to_client: true,
    created_by: input.lawyerId,
    tenant_id: input.tenantId,
  });

  if (isMissingColumnError(insertResult.error)) {
    await admin.from('case_updates').insert({
      case_id: input.caseId,
      message: markerMessage,
      is_public_to_client: true,
      created_by: input.lawyerId,
    });
  }
}

async function ensureHearingTimeline(input: {
  caseId: string;
  lawyerId: string;
  tenantId: string;
  caseDef: SeedCaseDefinition;
}) {
  const admin = createPortalSeedAdminClient();
  const existing = await admin
    .from('case_timeline_events')
    .select('id')
    .eq('case_id', input.caseId)
    .eq('title', input.caseDef.hearingTitle)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    return;
  }

  const metadata = {
    seedKey: 'portal_demo_v2',
    eventKind: 'hearing',
    scheduledAt: input.caseDef.hearingAtIso,
    courtName: input.caseDef.courtName,
  };

  const insertResult = await admin.from('case_timeline_events').insert({
    case_id: input.caseId,
    event_type: 'reminder',
    title: input.caseDef.hearingTitle,
    description: `${SEED_MARKER} ${input.caseDef.hearingDescription}`,
    metadata,
    created_by: input.lawyerId,
    tenant_id: input.tenantId,
  });

  if (isMissingColumnError(insertResult.error)) {
    await admin.from('case_timeline_events').insert({
      case_id: input.caseId,
      event_type: 'reminder',
      title: input.caseDef.hearingTitle,
      description: `${SEED_MARKER} ${input.caseDef.hearingDescription}`,
      metadata,
      created_by: input.lawyerId,
    });
  }
}

async function ensureDocument(input: {
  caseId: string;
  lawyerId: string;
  tenantId: string;
  caseDef: SeedCaseDefinition;
}) {
  const admin = createPortalSeedAdminClient();
  const existing = await admin
    .from('case_documents')
    .select('id')
    .eq('case_id', input.caseId)
    .eq('file_name', input.caseDef.documentName)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    return;
  }

  const contentBase64 = Buffer.from(input.caseDef.documentText, 'utf8').toString('base64');
  const insertResult = await admin.from('case_documents').insert({
    case_id: input.caseId,
    file_name: input.caseDef.documentName,
    mime_type: 'text/plain',
    file_size: Buffer.byteLength(input.caseDef.documentText, 'utf8'),
    content_base64: contentBase64,
    uploaded_by: input.lawyerId,
    metadata: {
      seedKey: 'portal_demo_v2',
      marker: SEED_MARKER,
    },
    tenant_id: input.tenantId,
  });

  if (isMissingColumnError(insertResult.error)) {
    await admin.from('case_documents').insert({
      case_id: input.caseId,
      file_name: input.caseDef.documentName,
      mime_type: 'text/plain',
      file_size: Buffer.byteLength(input.caseDef.documentText, 'utf8'),
      content_base64: contentBase64,
      uploaded_by: input.lawyerId,
      metadata: {
        seedKey: 'portal_demo_v2',
        marker: SEED_MARKER,
      },
    });
  }
}

async function ensureMessageLedger(input: {
  caseId: string;
  clientId: string;
  tenantId: string;
  lawyerId: string;
  clientName: string;
}) {
  const admin = createPortalSeedAdminClient();
  const existing = await admin
    .from('portal_case_messages')
    .select('id')
    .eq('case_id', input.caseId)
    .eq('client_id', input.clientId)
    .ilike('body', `${SEED_MARKER}%`)
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    return;
  }

  await admin
    .from('portal_case_messages')
    .insert({
      tenant_id: input.tenantId,
      case_id: input.caseId,
      client_id: input.clientId,
      sender_user_id: input.lawyerId,
      body: `${SEED_MARKER} Merhaba ${input.clientName}, dosyanızın güncel durumu paylaşıldı.`,
      metadata: {
        source: 'demo_seed',
      },
    })
    .then(() => undefined)
    .catch(() => undefined);
}

async function ensureNotification(input: {
  tenantId: string;
  recipientUserId: string | null;
  caseId: string;
  title: string;
  detail: string;
}) {
  if (!input.recipientUserId) {
    return;
  }

  const admin = createPortalSeedAdminClient();
  await admin
    .from('notifications')
    .insert({
      recipient_id: input.recipientUserId,
      actor_id: null,
      type: 'portal_demo_case_update',
      title: input.title,
      body: `${SEED_MARKER} ${input.detail}`,
      resource_type: 'case',
      resource_id: input.caseId,
      is_read: false,
      tenant_id: input.tenantId,
    })
    .then(() => undefined)
    .catch(async (error) => {
      if (isMissingColumnError(error)) {
        await admin
          .from('notifications')
          .insert({
            recipient_id: input.recipientUserId,
            actor_id: null,
            type: 'portal_demo_case_update',
            title: input.title,
            body: `${SEED_MARKER} ${input.detail}`,
            resource_type: 'case',
            resource_id: input.caseId,
            is_read: false,
          })
          .then(() => undefined)
          .catch(() => undefined);
      }
    });
}

export async function seedPortalDemoDataset(input?: {
  preferredLawyerId?: string | null;
  preferredTenantId?: string | null;
  demoClientEmail?: string | null;
  demoClientName?: string | null;
}) {
  const { lawyerId, tenantId } = await resolveLawyerAndTenant({
    preferredLawyerId: input?.preferredLawyerId ?? null,
    preferredTenantId: input?.preferredTenantId ?? null,
  });

  const demoClient = await resolveOrCreateDemoClient({
    tenantId,
    lawyerId,
    demoClientEmail: input?.demoClientEmail ?? process.env.PORTAL_DEMO_CLIENT_EMAIL ?? null,
    demoClientName: input?.demoClientName ?? process.env.PORTAL_DEMO_CLIENT_NAME ?? 'Demo Müvekkil',
  });

  const cases = [];
  for (const caseDef of buildCaseDefinitions()) {
    const demoCase = await resolveOrCreateDemoCase({
      tenantId,
      lawyerId,
      clientProfileId: demoClient.clientProfileId,
      caseDef,
    });

    await ensureCaseClientLink({
      caseId: demoCase.caseId,
      clientId: demoClient.clientId,
      tenantId,
      lawyerId,
    }).catch(() => undefined);
    await ensureCaseUpdate({
      caseId: demoCase.caseId,
      message: caseDef.updateMessage,
      lawyerId,
      tenantId,
    }).catch(() => undefined);
    await ensureHearingTimeline({
      caseId: demoCase.caseId,
      lawyerId,
      tenantId,
      caseDef,
    }).catch(() => undefined);
    await ensureDocument({
      caseId: demoCase.caseId,
      lawyerId,
      tenantId,
      caseDef,
    }).catch(() => undefined);
    await ensureMessageLedger({
      caseId: demoCase.caseId,
      clientId: demoClient.clientId,
      tenantId,
      lawyerId,
      clientName: demoClient.clientName,
    }).catch(() => undefined);
    await ensureNotification({
      tenantId,
      recipientUserId: demoClient.clientProfileId,
      caseId: demoCase.caseId,
      title: 'Demo dosya güncellemesi',
      detail: caseDef.updateMessage,
    }).catch(() => undefined);

    cases.push({
      id: demoCase.caseId,
      title: caseDef.title,
      status: demoCase.status,
      fileNo: caseDef.fileNo,
      hearingAt: caseDef.hearingAtIso,
    });
  }

  return {
    marker: SEED_MARKER,
    tenantId,
    lawyerId,
    demoClientId: demoClient.clientId,
    demoClientProfileId: demoClient.clientProfileId,
    demoClientName: demoClient.clientName,
    cases,
  };
}
