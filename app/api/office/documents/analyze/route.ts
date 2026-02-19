import { z } from 'zod';
import { publishOfficeNotification } from '@/lib/office/notifications';

const bodySchema = z.object({
  documentName: z.string().min(1),
  complexity: z.enum(['standard', 'handwritten']),
  googleVisionApproved: z.boolean().optional(),
  viewerRole: z.enum(['lawyer', 'assistant']).default('lawyer'),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('Geçersiz belge analizi isteği.', { status: 400 });
  }

  const payload = parsed.data;

  if (payload.complexity === 'handwritten' && !payload.googleVisionApproved) {
    return Response.json({
      provider: 'none',
      status: 'approval_required',
      message: 'El yazısı veya karmaşık belge için Google Vision onayı gereklidir.',
    });
  }

  const provider = payload.complexity === 'standard' ? 'tesseract' : 'google_vision';

  publishOfficeNotification({
    type: 'document_uploaded',
    category: 'documents',
    title: 'Yeni belge işlendi',
    detail: `${payload.documentName} belgesi ${provider} ile işlendi.`,
    actionUrl: '/office/documents',
    actionLabel: 'Belgelere Git',
  });

  const watermark = null;

  return Response.json({
    provider,
    status: 'processed',
    watermark,
  });
}
