import { z } from 'zod';
import { detectRiskySentiment } from '@/lib/portal/sentiment';
import { publishOfficeNotification } from '@/lib/office/notifications';

const bodySchema = z.object({
  message: z.string().min(1),
  caseId: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('Mesaj verisi geçersiz.', { status: 400 });
  }

  const sentiment = detectRiskySentiment(parsed.data.message);

  if (sentiment.isRisky) {
    publishOfficeNotification({
      type: 'risk_communication',
      category: 'messages',
      title: 'Riskli İletişim Uyarısı',
      detail: `Dosya ${parsed.data.caseId} mesajında negatif ton algılandı: ${sentiment.matched.join(', ')}`,
      actionUrl: `/portal/cases/${parsed.data.caseId}`,
      actionLabel: 'Mesajı Gör',
    });
  }

  return Response.json({
    accepted: true,
    risky: sentiment.isRisky,
    matchedKeywords: sentiment.matched,
  });
}
