import { streamObject, streamText } from 'ai';
import { z } from 'zod';
import { PetitionSchema } from '@/lib/ai/schemas';
import { buildLegalSystemPrompt } from '@/lib/ai/system-prompt';
import { resolveLegalModelWithFallback, type LegalModelTier } from '@/lib/ai/model-provider';
import { enforceTokenRateLimit } from '@/lib/ai/rate-limit';
import { scrubPii } from '@/lib/ai/pii-scrubber';

export const maxDuration = 30;

const requestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  tier: z.enum(['drafting', 'summary']).optional(),
  outputMode: z.enum(['text', 'petition']).optional(),
});

function getClientIdentifier(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const clientIp = forwardedFor?.split(',')[0]?.trim() ?? realIp ?? 'anonymous';
  return `ip:${clientIp}`;
}

function encodePiiMap(payload: unknown): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf-8').toString('base64');
}

export async function POST(req: Request) {
  try {
    const requestBody = requestSchema.safeParse(await req.json());

    if (!requestBody.success) {
      return new Response('Geçersiz istek gövdesi.', { status: 400 });
    }

    const { messages, outputMode = 'text', tier = 'drafting' } = requestBody.data;

    const payloadText = messages.map((item) => item.content).join('\n');
    const rateLimitResult = await enforceTokenRateLimit(getClientIdentifier(req), payloadText);

    if (!rateLimitResult.success) {
      return new Response('İstek sınırına ulaşıldı. Lütfen kısa bir süre sonra tekrar deneyin.', {
        status: 429,
      });
    }

    const modelSelection = await resolveLegalModelWithFallback(tier as LegalModelTier);

    const piiMappings = {
      persons: new Map<string, string>(),
      tcIds: new Map<string, string>(),
    };

    const scrubbedMessages = messages.map((message) => {
      const scrubResult = scrubPii(message.content);

      scrubResult.mappings.personMap.forEach((token, original) => {
        piiMappings.persons.set(token, original);
      });

      scrubResult.mappings.tcIdMap.forEach((token, original) => {
        piiMappings.tcIds.set(token, original);
      });

      return {
        ...message,
        content: scrubResult.text,
      };
    });

    const piiMapHeader = encodePiiMap({
      persons: Object.fromEntries(piiMappings.persons.entries()),
      tcIds: Object.fromEntries(piiMappings.tcIds.entries()),
    });

    const systemPrompt = `${buildLegalSystemPrompt()}\n\nModelProvider: ${modelSelection.providerName}:${modelSelection.modelId}`;

    if (outputMode === 'petition') {
      const promptText = scrubbedMessages
        .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
        .join('\n\n');

      const objectResult = streamObject({
        model: modelSelection.model,
        schema: PetitionSchema,
        prompt: `${systemPrompt}\n\n${promptText}`,
      });

      const response = objectResult.toTextStreamResponse();
      response.headers.set('x-pii-map', piiMapHeader);
      return response;
    }

    const textResult = streamText({
      model: modelSelection.model,
      system: systemPrompt,
      messages: scrubbedMessages,
      temperature: tier === 'summary' ? 0.3 : 0.2,
    });

    const response = textResult.toDataStreamResponse();
    response.headers.set('x-pii-map', piiMapHeader);
    return response;
  } catch {
    return new Response('AI hizmeti geçici olarak kullanılamıyor.', {
      status: 500,
    });
  }
}
