import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  canAccessCase: vi.fn(),
  logDashboardAudit: vi.fn(),
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

vi.mock('@/lib/dashboard/audit', () => ({
  logDashboardAudit: mocked.logDashboardAudit,
}));

import { DELETE, GET, PATCH, POST } from '@/app/api/dashboard/cases/timeline/route';

function buildTimelineListChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

function buildDeleteChain(result: unknown) {
  const chain = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockResolvedValue(result);
  return chain;
}

describe('/api/dashboard/cases/timeline authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 403 when case access is denied', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(false);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await GET(new Request('http://localhost/api/dashboard/cases/timeline?caseId=11111111-1111-4111-8111-111111111111'));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu dosyanin zaman çizelgesine erisim yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('GET returns timeline entries for authorized lawyer', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'lawyer-user',
      role: 'lawyer',
    });
    mocked.canAccessCase.mockResolvedValue(true);

    const timelineLookup = buildTimelineListChain({
      data: [
        {
          id: 'evt-1',
          event_type: 'note',
          title: 'Not eklendi',
          description: 'İlk not',
          metadata: {},
          created_by: 'lawyer-user',
          created_at: '2026-03-26T10:00:00.000Z',
          updated_at: '2026-03-26T10:00:00.000Z',
        },
      ],
      error: null,
    });
    const admin = {
      from: vi.fn().mockReturnValue(timelineLookup),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await GET(new Request('http://localhost/api/dashboard/cases/timeline?caseId=11111111-1111-4111-8111-111111111111'));
    const payload = (await response.json()) as { items?: Array<{ id: string; title: string }> };

    expect(response.status).toBe(200);
    expect(payload.items?.length).toBe(1);
    expect(payload.items?.[0]?.id).toBe('evt-1');
    expect(payload.items?.[0]?.title).toBe('Not eklendi');
  });

  it('POST returns 403 when case access is denied', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(false);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: '11111111-1111-4111-8111-111111111111',
          eventType: 'note',
          title: 'Not',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu dosyada event ekleme yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('PATCH returns 403 when case access is denied', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(false);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await PATCH(
      new Request('http://localhost/api/dashboard/cases/timeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: '22222222-2222-4222-8222-222222222222',
          caseId: '11111111-1111-4111-8111-111111111111',
          title: 'Güncellendi',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu dosyada event düzenleme yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('DELETE blocks non-lawyer role before touching db', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
    });
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await DELETE(
      new Request('http://localhost/api/dashboard/cases/timeline', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: '22222222-2222-4222-8222-222222222222',
          caseId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Timeline event silme için avukat yetkisi gerekir.');
    expect(mocked.canAccessCase).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('DELETE succeeds for authorized lawyer', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'lawyer-user',
      role: 'lawyer',
    });
    mocked.canAccessCase.mockResolvedValue(true);

    const deleteChain = buildDeleteChain({ error: null });
    const timelineInsert = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const admin = {
      from: vi.fn().mockReturnValueOnce(deleteChain).mockReturnValueOnce(timelineInsert),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await DELETE(
      new Request('http://localhost/api/dashboard/cases/timeline', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: '22222222-2222-4222-8222-222222222222',
          caseId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    const payload = (await response.json()) as { success?: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mocked.canAccessCase).toHaveBeenCalled();
    expect(mocked.logDashboardAudit).toHaveBeenCalled();
  });
});
