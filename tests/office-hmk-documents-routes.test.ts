import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  publishOfficeNotification: vi.fn(),
}));

vi.mock('@/lib/office/team-access', () => ({
  requireInternalOfficeUser: mocked.requireInternalOfficeUser,
}));

vi.mock('@/lib/office/notifications', () => ({
  publishOfficeNotification: mocked.publishOfficeNotification,
}));

import { POST as postHmkConfirm } from '@/app/api/office/hmk/confirm/route';
import { POST as postDocumentAnalyze } from '@/app/api/office/documents/analyze/route';

function buildCaseLookup(result: { data: unknown; error: unknown }) {
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

describe('Office HMK + documents access checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('HMK confirm requires lawyer role', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'assistant',
      bureauId: 'bureau-1',
      supabase: {},
    });

    const response = await postHmkConfirm(
      new Request('http://localhost/api/office/hmk/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          serviceDate: '2026-03-27',
          estimatedDate: '2026-04-10',
          accepted: true,
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('HMK onayı için avukat yetkisi gerekir.');
  });

  it('HMK confirm rejects case outside office scope', async () => {
    const caseLookup = buildCaseLookup({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'cases') return caseLookup;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'lawyer',
      bureauId: 'bureau-1',
      supabase,
    });

    const response = await postHmkConfirm(
      new Request('http://localhost/api/office/hmk/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          serviceDate: '2026-03-27',
          estimatedDate: '2026-04-10',
          accepted: true,
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Dosya ofis kapsaminda bulunamadi.');
  });

  it('document analyze requires internal office access', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: false,
      status: 401,
      message: 'Oturum doğrulanamadı.',
    });

    const response = await postDocumentAnalyze(
      new Request('http://localhost/api/office/documents/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentName: 'test.pdf',
          complexity: 'standard',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Oturum doğrulanamadı.');
  });
});
