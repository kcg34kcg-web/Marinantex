import 'server-only';
import { z } from 'zod';

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  COHERE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
});

const parsed = serverEnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  COHERE_API_KEY: process.env.COHERE_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});

export const serverEnv = {
  ...parsed,
  SUPABASE_SERVICE_KEY: parsed.SUPABASE_SERVICE_ROLE_KEY ?? parsed.SUPABASE_SERVICE_KEY ?? '',
};

export function requireAiProviderKeys() {
  const missing: string[] = [];

  if (!serverEnv.GOOGLE_GENERATIVE_AI_API_KEY) {
    missing.push('GOOGLE_GENERATIVE_AI_API_KEY');
  }

  if (!serverEnv.COHERE_API_KEY) {
    missing.push('COHERE_API_KEY');
  }

  return {
    ok: missing.length === 0,
    missing,
  } as const;
}
