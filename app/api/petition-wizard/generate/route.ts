import { generateObject } from 'ai';
import { z } from 'zod';
import {
  aiSelfCheckSchema,
  aiStructuredPetitionSchema,
  aiVariableBlocksSchema,
  petitionGenerateInputSchema,
} from '@/lib/petition-wizard/types';
import {
  buildDeterministicPetitionDraft,
  normalizePetitionInput,
} from '@/lib/petition-wizard/engine';
import { resolveLegalModelWithFallback } from '@/lib/ai/model-provider';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const sourceProjectionSchema = z.object({
  petition_type: z.string(),
  court_name: z.string(),
  parties: z.array(
    z.object({
      role: z.string(),
      name: z.string(),
      representative: z.string().optional().default(''),
    }),
  ),
  event_summary: z.string(),
  chronology: z.array(
    z.object({
      date: z.string().optional().default(''),
      event: z.string().optional().default(''),
      related_evidence: z.string().optional().default(''),
    }),
  ),
  legal_reasons: z.string(),
  requests: z.array(z.string()),
  evidence: z.array(z.string()),
  attachments: z.array(z.string()),
  date: z.string(),
  city: z.string(),
  signer_name: z.string(),
});

function buildStructuringPrompt(sourceJson: string): string {
  return [
    'Role: legal petition normalizer.',
    'Task: normalize given input into structured petition data.',
    'Hard rules:',
    '- Use only the provided data.',
    '- Do not add any new facts, dates, people, institutions, law article numbers, or precedent numbers.',
    '- If data is missing/unclear, keep text as "belirtilmemis" and list missing fields.',
    '- Do not claim certainty or guaranteed legal outcome.',
    '- Keep requests and evidence as short bullet-like entries.',
    '',
    'Input JSON:',
    sourceJson,
  ].join('\n');
}

function buildVariableBlocksPrompt(sourceJson: string): string {
  return [
    'Role: legal drafting assistant for variable paragraphs only.',
    'Task: generate only two variable blocks for a deterministic petition template:',
    '1) facts_paragraph',
    '2) result_paragraph',
    'Hard rules:',
    '- Use only the provided JSON data.',
    '- Never add new facts, law article numbers, precedent numbers, or legal certainty claims.',
    '- If missing information exists, use "belirtilmemis" and also list it in missing_fields.',
    '- Keep tone formal, neutral, and concise.',
    '',
    'Source JSON:',
    sourceJson,
  ].join('\n');
}

function buildSelfCheckPrompt(sourceJson: string, draftText: string): string {
  return [
    'Role: legal integrity checker.',
    'Task: compare source JSON and draft text.',
    'Check for fabrication:',
    '- Any fact/date/person/institution that does not exist in source JSON.',
    '- Any law article number or precedent number not explicitly in source JSON.',
    '- Any certainty claim like guaranteed win.',
    'Return has_fabrication=true if any issue exists and list issues precisely.',
    '',
    'Source JSON:',
    sourceJson,
    '',
    'Draft text:',
    draftText,
  ].join('\n');
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Gecersiz JSON govdesi.' }, { status: 400 });
  }

  const parsedBody = petitionGenerateInputSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return Response.json({ error: 'Dilekce verisi gecersiz veya eksik.' }, { status: 400 });
  }

  const normalizedInput = normalizePetitionInput(parsedBody.data);
  const deterministicOnlyResult = buildDeterministicPetitionDraft(normalizedInput);

  if (!normalizedInput.use_ai_refinement) {
    return Response.json(deterministicOnlyResult);
  }

  try {
    const modelSelection = await resolveLegalModelWithFallback('drafting');
    const projectedSource = sourceProjectionSchema.parse({
      petition_type: normalizedInput.petition_type,
      court_name: normalizedInput.court_name,
      parties: normalizedInput.parties,
      event_summary: normalizedInput.event_summary,
      chronology: normalizedInput.chronology,
      legal_reasons: normalizedInput.legal_reasons,
      requests: normalizedInput.requests,
      evidence: normalizedInput.evidence,
      attachments: normalizedInput.attachments,
      date: normalizedInput.date,
      city: normalizedInput.city,
      signer_name: normalizedInput.signer_name,
    });
    const sourceJson = JSON.stringify(projectedSource, null, 2);

    const stage1 = await generateObject({
      model: modelSelection.model,
      schema: aiStructuredPetitionSchema,
      prompt: buildStructuringPrompt(sourceJson),
      temperature: 0,
    });

    const structured = stage1.object;
    const mergedInput = normalizePetitionInput({
      ...normalizedInput,
      event_summary: structured.normalized_event_summary || normalizedInput.event_summary,
      chronology: structured.chronology.length > 0 ? structured.chronology : normalizedInput.chronology,
      requests: structured.requests.length > 0 ? structured.requests : normalizedInput.requests,
      evidence: structured.evidence.length > 0 ? structured.evidence : normalizedInput.evidence,
    });

    const stage2 = await generateObject({
      model: modelSelection.model,
      schema: aiVariableBlocksSchema,
      prompt: buildVariableBlocksPrompt(sourceJson),
      temperature: 0.1,
    });

    const variableBlocks = stage2.object;
    const hybridDraft = buildDeterministicPetitionDraft(mergedInput, {
      factsParagraph: variableBlocks.facts_paragraph,
      resultParagraph: variableBlocks.result_paragraph,
      extraWarnings: [...structured.warnings, ...variableBlocks.warnings],
      extraMissingFields: [...structured.missing_fields, ...variableBlocks.missing_fields],
      extraConfidenceNotes: [
        ...variableBlocks.confidence_notes,
        `Model: ${modelSelection.providerName}:${modelSelection.modelId}`,
      ],
    });

    const stage3 = await generateObject({
      model: modelSelection.model,
      schema: aiSelfCheckSchema,
      prompt: buildSelfCheckPrompt(sourceJson, hybridDraft.draft_text),
      temperature: 0,
    });

    if (stage3.object.has_fabrication) {
      const fallbackWarnings = stage3.object.issues.map((issue: string) => `AI denetim notu: ${issue}`);

      return Response.json(
        buildDeterministicPetitionDraft(mergedInput, {
          extraWarnings: [
            ...structured.warnings,
            ...variableBlocks.warnings,
            ...fallbackWarnings,
            'AI degisken bloklari olasi uydurma riski nedeniyle devre disi birakildi.',
          ],
          extraMissingFields: [...structured.missing_fields, ...variableBlocks.missing_fields],
          extraConfidenceNotes: [
            'Kendini denetleme adimi olasi uydurma isaretledi. Deterministik cikti kullanildi.',
          ],
        }),
      );
    }

    return Response.json(hybridDraft);
  } catch {
    return Response.json(
      buildDeterministicPetitionDraft(normalizedInput, {
        extraWarnings: [
          'AI iyilestirme adimi su an calismiyor. Deterministik taslak olusturuldu.',
        ],
      }),
    );
  }
}
