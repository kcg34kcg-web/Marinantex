import { generateText } from 'ai';
import { z } from 'zod';
import { resolveLegalModelWithFallback } from '@/lib/ai/model-provider';

const refineSchema = z.object({
  selectedText: z.string().min(20),
  caseFacts: z.string().min(20),
  legalClaim: z.string().min(3),
});

export async function POST(request: Request) {
  try {
    const payload = refineSchema.safeParse(await request.json());

    if (!payload.success) {
      return new Response('Geçersiz argüman güçlendirme isteği.', { status: 400 });
    }

    const modelSelection = await resolveLegalModelWithFallback('drafting');

    const result = await generateText({
      model: modelSelection.model,
      system: [
        'Sen kıdemli bir hukuk ortağısın.',
        'Görev: Seçili metni hukuki yönden güçlendir.',
        'Kısıt: Olgusal olayları değiştirme, yalnızca hukuki nitelendirmeyi güçlendir.',
        'Kısa, açık ve dava diline uygun yaz.',
      ].join('\n'),
      prompt: [
        `Hukuki iddia: ${payload.data.legalClaim}`,
        `Vaka olguları: ${payload.data.caseFacts}`,
        `Güçlendirilecek metin: ${payload.data.selectedText}`,
      ].join('\n\n'),
      temperature: 0.2,
    });

    return Response.json({
      refinedText: result.text,
      constraint: 'Factual events preserved',
    });
  } catch {
    return new Response('Argüman güçlendirme servisi kullanılamıyor.', { status: 500 });
  }
}
