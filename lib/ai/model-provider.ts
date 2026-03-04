import { cohere } from '@ai-sdk/cohere';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateObject, streamText } from 'ai';
import { serverEnv } from '@/lib/config/env.server';
import { modelHealthSchema } from '@/lib/ai/schemas';

export type LegalModelTier = 'drafting' | 'summary';
type SupportedModel = Parameters<typeof streamText>[0]['model'];

interface LegalModelSelection {
  model: SupportedModel;
  providerName: 'google' | 'cohere' | 'openai';
  modelId: string;
}

const SUMMARY_PRIMARY_MODEL_ID = 'gemini-2.5-flash-lite';
const SUMMARY_FALLBACK_MODEL_ID = 'gemini-2.0-flash-lite';

export const getLegalModel = (tier: LegalModelTier = 'drafting'): SupportedModel => {
  if (!serverEnv.GOOGLE_GENERATIVE_AI_API_KEY) {
    return getFallbackDraftingModel();
  }

  if (tier === 'summary') {
    return google(SUMMARY_PRIMARY_MODEL_ID);
  }

  return google('gemini-1.5-pro');
};

function getFallbackSummaryModel(): SupportedModel {
  if (serverEnv.COHERE_API_KEY) {
    return cohere('command-r') as unknown as SupportedModel;
  }

  return openai('gpt-4o-mini') as SupportedModel;
}

function getFallbackDraftingModel(): SupportedModel {
  if (serverEnv.COHERE_API_KEY) {
    return cohere('command-r-plus') as unknown as SupportedModel;
  }

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

export async function resolveLegalModelWithFallback(tier: LegalModelTier = 'drafting'): Promise<LegalModelSelection> {
  if (tier === 'summary') {
    if (!serverEnv.GOOGLE_GENERATIVE_AI_API_KEY) {
      const fallbackSummaryModel = getFallbackSummaryModel();
      return {
        model: fallbackSummaryModel,
        providerName: serverEnv.COHERE_API_KEY ? 'cohere' : 'openai',
        modelId: serverEnv.COHERE_API_KEY ? 'command-r' : 'gpt-4o-mini',
      };
    }

    const summaryModel = google(SUMMARY_PRIMARY_MODEL_ID) as SupportedModel;
    const isSummaryPrimaryHealthy = await checkModelHealth(summaryModel);
    if (isSummaryPrimaryHealthy) {
      return {
        model: summaryModel,
        providerName: 'google',
        modelId: SUMMARY_PRIMARY_MODEL_ID,
      };
    }

    const summaryFallbackModel = google(SUMMARY_FALLBACK_MODEL_ID) as SupportedModel;
    const isSummaryFallbackHealthy = await checkModelHealth(summaryFallbackModel);
    if (isSummaryFallbackHealthy) {
      return {
        model: summaryFallbackModel,
        providerName: 'google',
        modelId: SUMMARY_FALLBACK_MODEL_ID,
      };
    }

    const fallbackSummaryModel = getFallbackSummaryModel();
    return {
      model: fallbackSummaryModel,
      providerName: serverEnv.COHERE_API_KEY ? 'cohere' : 'openai',
      modelId: serverEnv.COHERE_API_KEY ? 'command-r' : 'gpt-4o-mini',
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
    providerName: serverEnv.COHERE_API_KEY ? 'cohere' : 'openai',
    modelId: serverEnv.COHERE_API_KEY ? 'command-r-plus' : 'gpt-4o',
  };
}
