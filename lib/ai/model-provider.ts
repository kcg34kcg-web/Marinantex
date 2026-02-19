import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateObject, streamText } from 'ai';
import { modelHealthSchema } from '@/lib/ai/schemas';

export type LegalModelTier = 'drafting' | 'summary';
type SupportedModel = Parameters<typeof streamText>[0]['model'];

interface LegalModelSelection {
  model: SupportedModel;
  providerName: 'google' | 'openai';
  modelId: string;
}

export const getLegalModel = (tier: LegalModelTier = 'drafting'): SupportedModel => {
  if (tier === 'summary') {
    return google('gemini-1.5-flash');
  }

  return google('gemini-1.5-pro');
};

function getFallbackDraftingModel(): SupportedModel {
  return openai('gpt-4o') as SupportedModel;
}

async function checkModelHealth(model: SupportedModel, timeoutMs = 10_000): Promise<boolean> {
  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });

  const testPromise = generateObject({
    model,
    schema: modelHealthSchema,
    prompt: 'Return {"ok": true}.',
    temperature: 0,
  })
    .then((result) => result.object.ok)
    .catch(() => false);

  return Promise.race([testPromise, timeoutPromise]);
}

export async function resolveLegalModelWithFallback(
  tier: LegalModelTier = 'drafting'
): Promise<LegalModelSelection> {
  if (tier === 'summary') {
    const summaryModel = getLegalModel('summary');
    return {
      model: summaryModel,
      providerName: 'google',
      modelId: 'gemini-1.5-flash',
    };
  }

  const primaryModel = getLegalModel('drafting');
  const isPrimaryHealthy = await checkModelHealth(primaryModel);

  if (isPrimaryHealthy) {
    return {
      model: primaryModel,
      providerName: 'google',
      modelId: 'gemini-1.5-pro',
    };
  }

  return {
    model: getFallbackDraftingModel(),
    providerName: 'openai',
    modelId: 'gpt-4o',
  };
}
