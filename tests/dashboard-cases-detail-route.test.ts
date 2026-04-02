import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  canAccessCase: vi.fn(),
}));

vi.mock('@/lib/office/team-access', () => ({
  requireInternalOfficeUser: mocked.requireInternalOfficeUser,
}));

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: mocked.createAdminClient,
}));

vi.mock('@/lib/dashboard/access', () => ({
  canAccessCase: mocked.canAccessCase,
}));

import { GET } from '@/app/api/dashboard/cases/detail/route';

function buildCaseQueryChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return chain;
}

function buildCaseClientsQueryChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockResolvedValue(result);
  return chain;
}

function buildClientsLookupChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.is.mockResolvedValue(result);
  return chain;
}

describe('GET /api/dashboard/cases/detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when case access is denied', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(false);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await GET(new Request('http://localhost/api/dashboard/cases/detail?caseId=11111111-1111-4111-8111-111111111111'));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu dosyayi görüntüleme yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('returns case detail for authorized lawyer', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'lawyer-user',
      role: 'lawyer',
    });
    mocked.canAccessCase.mockResolvedValue(true);

    const caseLookup = buildCaseQueryChain({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Örnek Dosya',
        status: 'open',
        file_no: '2026/100',
        case_code: 'MRN-2026-ABC123',
        tags: ['icra'],
        overview_notes: 'Özet',
        overview_notes_updated_at: '2026-03-26T10:00:00.000Z',
        updated_at: '2026-03-26T10:00:00.000Z',
        created_at: '2026-03-25T10:00:00.000Z',
      },
      error: null,
    });
    const caseClientsLookup = buildCaseClientsQueryChain({
      data: [
        {
          id: 'rel-1',
          case_id: '11111111-1111-4111-8111-111111111111',
          client_id: '22222222-2222-4222-8222-222222222222',
          public_ref_code: 'CLI-REF-1',
          relation_note: 'Asil',
          created_at: '2026-03-26T10:00:00.000Z',
        },
      ],
      error: null,
    });
    const aiSummaryLookup = buildCaseQueryChain({
      data: {
        id: 'sum-1',
        summary_text: 'AI özeti',
        status: 'ready',
        last_generated_at: '2026-03-26T11:00:00.000Z',
        updated_at: '2026-03-26T11:00:00.000Z',
      },
      error: null,
    });
    const clientsLookup = buildClientsLookupChain({
      data: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          full_name: 'Müvekkil A',
          email: 'client@example.com',
          file_no: 'CL-100',
          public_ref_code: 'CL-REF-100',
        },
      ],
      error: null,
    });

    const admin = {
      from: vi
        .fn()
        .mockReturnValueOnce(caseLookup)
        .mockReturnValueOnce(caseClientsLookup)
        .mockReturnValueOnce(aiSummaryLookup)
        .mockReturnValueOnce(clientsLookup),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await GET(new Request('http://localhost/api/dashboard/cases/detail?caseId=11111111-1111-4111-8111-111111111111'));
    const payload = (await response.json()) as {
      case?: { id?: string; linkedClients?: Array<{ id: string }> };
      aiSummary?: { id?: string } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.case?.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload.case?.linkedClients?.length).toBe(1);
    expect(payload.aiSummary?.id).toBe('sum-1');
  });
});
