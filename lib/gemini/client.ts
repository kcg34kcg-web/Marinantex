import { GoogleGenAI } from '@google/genai';
import { serverEnv } from '@/lib/config/env.server';

let singleton: GoogleGenAI | null = null;

export function getGeminiClient() {
  const apiKey = serverEnv.GEMINI_API_KEY ?? serverEnv.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY tanımlı değil.');
  }

  if (!singleton) {
    singleton = new GoogleGenAI({ apiKey });
  }

  return singleton;
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-3-flash-preview';
}
