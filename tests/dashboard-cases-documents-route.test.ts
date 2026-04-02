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

import { POST } from '@/app/api/dashboard/cases/documents/route';

function buildUploadRequest(fileName: string, mimeType: string) {
  const formData = new FormData();
  formData.set('caseId', '11111111-1111-4111-8111-111111111111');
  formData.set('file', new File([new Uint8Array([1, 2, 3])], fileName, { type: mimeType }));
  return new Request('http://localhost/api/dashboard/cases/documents', {
    method: 'POST',
    body: formData,
  });
}

function buildDocumentInsertChain(result: unknown) {
  const chain = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.single.mockResolvedValue(result);
  return chain;
}

describe('POST /api/dashboard/cases/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects upload when extension is not allowed even if mime type is allowed', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(true);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(buildUploadRequest('proof.exe', 'application/pdf'));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Desteklenmeyen dosya formati');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('rejects upload when mime type is not allowed even if extension is allowed', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(true);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(buildUploadRequest('proof.pdf', 'text/plain'));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Desteklenmeyen dosya formati');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('accepts upload when both extension and mime type are allowed', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'lawyer',
    });
    mocked.canAccessCase.mockResolvedValue(true);

    const documentInsert = buildDocumentInsertChain({
      data: {
        id: 'doc-1',
        public_ref_code: 'DOC-REF-1',
        file_name: 'proof.pdf',
        mime_type: 'application/pdf',
        file_size: 3,
        uploaded_by: 'actor-user',
        created_at: '2026-03-27T08:00:00.000Z',
      },
      error: null,
    });
    const timelineInsert = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const admin = {
      from: vi.fn().mockReturnValueOnce(documentInsert).mockReturnValueOnce(timelineInsert),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(buildUploadRequest('proof.pdf', 'application/pdf'));
    const payload = (await response.json()) as { document?: { id?: string; fileName?: string } };

    expect(response.status).toBe(200);
    expect(payload.document?.id).toBe('doc-1');
    expect(payload.document?.fileName).toBe('proof.pdf');
    expect(mocked.logDashboardAudit).toHaveBeenCalled();
  });
});
