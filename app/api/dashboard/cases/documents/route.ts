import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const listQuerySchema = z.object({
  caseId: z.string().uuid(),
});

const deleteSchema = z.object({
  caseId: z.string().uuid(),
  documentId: z.string().uuid(),
});

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'jpg', 'jpeg', 'png']);

function toFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  if (parts.length < 2) {
    return '';
  }
  return parts[parts.length - 1].toLowerCase();
}

function normalizeFileName(fileName: string): string {
  return fileName.replace(/[\r\n\t]/g, ' ').trim().slice(0, 260);
}

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = listQuerySchema.safeParse({
    caseId: new URL(request.url).searchParams.get('caseId'),
  });

  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz caseId.' }, { status: 400 });
  }

  const caseId = parsed.data.caseId;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyadaki belgelere erisim yetkiniz yok.' }, { status: 403 });
  }

  const documentsResult = await admin
    .from('case_documents')
    .select('id, public_ref_code, file_name, mime_type, file_size, uploaded_by, created_at')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (documentsResult.error) {
    return Response.json({ error: 'Belge listesi alinamadi.' }, { status: 500 });
  }

  return Response.json({
    items: (documentsResult.data ?? []).map((item) => ({
      id: item.id,
      publicRefCode: item.public_ref_code,
      fileName: item.file_name,
      mimeType: item.mime_type,
      fileSize: item.file_size,
      uploadedBy: item.uploaded_by,
      createdAt: item.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const formData = await request.formData();
  const caseId = String(formData.get('caseId') ?? '');
  const fileEntry = formData.get('file');

  if (!caseId) {
    return Response.json({ error: 'caseId gereklidir.' }, { status: 400 });
  }

  if (!(fileEntry instanceof File)) {
    return Response.json({ error: 'Yüklenecek dosya bulunamadi.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyaya belge yükleme yetkiniz yok.' }, { status: 403 });
  }

  const extension = toFileExtension(fileEntry.name);
  const mimeType = (fileEntry.type || '').toLowerCase();

  if (!ALLOWED_MIME_TYPES.has(mimeType) && !ALLOWED_EXTENSIONS.has(extension)) {
    return Response.json({
      error: 'Desteklenmeyen dosya formati. Desteklenenler: PDF, DOCX, XLSX, JPG, PNG.',
    }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());

  if (fileBuffer.length === 0) {
    return Response.json({ error: 'Bos dosya yüklenemez.' }, { status: 400 });
  }

  if (fileBuffer.length > 20 * 1024 * 1024) {
    return Response.json({ error: 'Dosya boyutu 20MB sinirini asiyor.' }, { status: 400 });
  }

  const fileName = normalizeFileName(fileEntry.name || 'document');
  const contentBase64 = fileBuffer.toString('base64');

  const insertResult = await admin
    .from('case_documents')
    .insert({
      case_id: caseId,
      file_name: fileName,
      mime_type: mimeType || 'application/octet-stream',
      file_size: fileBuffer.length,
      content_base64: contentBase64,
      uploaded_by: access.userId,
      metadata: {
        extension,
      },
    })
    .select('id, public_ref_code, file_name, mime_type, file_size, uploaded_by, created_at')
    .single();

  if (insertResult.error || !insertResult.data) {
    return Response.json({ error: 'Belge yükleme basarisiz oldu.' }, { status: 500 });
  }

  await admin.from('case_timeline_events').insert({
    case_id: caseId,
    event_type: 'document_upload',
    title: 'Belge yüklendi',
    description: fileName,
    metadata: {
      documentId: insertResult.data.id,
      mimeType: insertResult.data.mime_type,
      fileSize: insertResult.data.file_size,
    },
    created_by: access.userId,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_document_uploaded',
    entityType: 'case_document',
    entityId: insertResult.data.id,
    metadata: {
      caseId,
      fileName,
      mimeType: insertResult.data.mime_type,
      fileSize: insertResult.data.file_size,
    },
  });

  return Response.json({
    document: {
      id: insertResult.data.id,
      publicRefCode: insertResult.data.public_ref_code,
      fileName: insertResult.data.file_name,
      mimeType: insertResult.data.mime_type,
      fileSize: insertResult.data.file_size,
      uploadedBy: insertResult.data.uploaded_by,
      createdAt: insertResult.data.created_at,
    },
  });
}

export async function DELETE(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  if (access.role !== 'lawyer') {
    return Response.json({ error: 'Belge silme islemi için avukat yetkisi gerekir.' }, { status: 403 });
  }

  const parsed = deleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz belge silme verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyadaki belgeyi silme yetkiniz yok.' }, { status: 403 });
  }

  const existingResult = await admin
    .from('case_documents')
    .select('id, file_name')
    .eq('id', payload.documentId)
    .eq('case_id', payload.caseId)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingResult.error || !existingResult.data) {
    return Response.json({ error: 'Belge bulunamadi.' }, { status: 404 });
  }

  const deleteResult = await admin
    .from('case_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', payload.documentId)
    .eq('case_id', payload.caseId)
    .is('deleted_at', null);

  if (deleteResult.error) {
    return Response.json({ error: 'Belge silinemedi.' }, { status: 500 });
  }

  await admin.from('case_timeline_events').insert({
    case_id: payload.caseId,
    event_type: 'user_action',
    title: 'Belge silindi',
    description: existingResult.data.file_name,
    metadata: {
      documentId: payload.documentId,
    },
    created_by: access.userId,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_document_deleted',
    entityType: 'case_document',
    entityId: payload.documentId,
    metadata: {
      caseId: payload.caseId,
      fileName: existingResult.data.file_name,
    },
  });

  return Response.json({ success: true });
}

