import { generateText } from 'ai';
import { z } from 'zod';
import { resolveLegalModelWithFallback } from '@/lib/ai/model-provider';
import { hasRedFlag, getRedFlagKeywords } from '@/lib/ai/red-flag';
import { getEditRatio } from '@/lib/ai/levenshtein';

const summarySchema = z.object({
  legalText: z.string().min(1),
  originalSummary: z.string().optional(),
  editedSummary: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const payload = summarySchema.safeParse(await request.json());

    if (!payload.success) {
      return new Response('Geçersiz özet isteği.', { status: 400 });
    }

    const { legalText, originalSummary, editedSummary } = payload.data;

    if (hasRedFlag(legalText)) {
      return Response.json(
        {
          blocked: true,
          reason: 'Kritik içerik tespit edildi. Avukat onayı olmadan otomatik özet üretilemez.',
          keywords: getRedFlagKeywords().filter((item) => legalText.toLocaleLowerCase('tr-TR').includes(item)),
        },
        { status: 409 }
      );
    }

    const modelSelection = await resolveLegalModelWithFallback('summary');
    const result = await generateText({
      model: modelSelection.model,
      system: [
        'Müvekkile açıklama yapıyorsun.',
        '12 yaşındaki bir çocuğun anlayacağı sadelikte yaz.',
        'Latince terim kullanma.',
        'En fazla 3 cümle yaz.',
      ].join('\n'),
      prompt: legalText,
      temperature: 0.2,
    });

    const editRatio =
      originalSummary && editedSummary
        ? getEditRatio(originalSummary, editedSummary)
        : null;

    return Response.json({
      blocked: false,
      summary: result.text,
      feedbackFlag: editRatio !== null ? editRatio > 0.3 : false,
      editRatio,
    });
  } catch {
    return new Response('Özet servisi şu anda kullanılamıyor.', { status: 500 });
  }
}
