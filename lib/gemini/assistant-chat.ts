import { assistantStructuredOutputSchema, type AssistantStructuredOutput } from '@/lib/validators/assistant';
import { getGeminiClient, getGeminiModel } from '@/lib/gemini/client';

interface GenerateAssistantPlanParams {
  systemPrompt: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function sanitizeJsonText(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

export async function generateAssistantPlan({ systemPrompt, message, history }: GenerateAssistantPlanParams): Promise<AssistantStructuredOutput> {
  const ai = getGeminiClient();
  const model = getGeminiModel();

  const historyText = history
    .slice(-8)
    .map((item) => `${item.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${item.content}`)
    .join('\n');

  const userPrompt = [
    historyText ? `Geçmiş:\n${historyText}` : null,
    `Son kullanıcı mesajı:\n${message}`,
    'Sadece geçerli JSON döndür.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await ai.models.generateContent({
    model,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.35,
      maxOutputTokens: 700,
      responseMimeType: 'application/json',
    },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  });

  const text = sanitizeJsonText(response.text ?? '');
  const parsed = JSON.parse(text);
  return assistantStructuredOutputSchema.parse(parsed);
}

export async function* streamAssistantReply(input: {
  systemPrompt: string;
  reply: string;
  language: 'tr' | 'en';
}): AsyncGenerator<string> {
  const ai = getGeminiClient();
  const model = getGeminiModel();

  const stream = await ai.models.generateContentStream({
    model,
    config: {
      systemInstruction: `${input.systemPrompt}\nYalnızca final cevabı üret. JSON üretme.`,
      temperature: 0.35,
      maxOutputTokens: 400,
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              input.language === 'tr'
                ? `Aşağıdaki yanıt taslağını daha akıcı ama kısa hale getir:\n${input.reply}`
                : `Rewrite this assistant draft into concise natural text:\n${input.reply}`,
          },
        ],
      },
    ],
  });

  let streamed = false;
  for await (const chunk of stream) {
    const text = chunk.text;
    if (text && text.length > 0) {
      streamed = true;
      yield text;
    }
  }

  if (!streamed) {
    yield input.reply;
  }
}
