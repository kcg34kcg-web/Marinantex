import { z } from 'zod';

export const partyRoleSchema = z.enum([
  'davaci',
  'davali',
  'sikayetci',
  'supheli',
  'magdur',
  'katilan',
  'vekil',
  'diger',
]);

export type PetitionPartyRole = z.infer<typeof partyRoleSchema>;

export const petitionPartySchema = z.object({
  role: partyRoleSchema,
  name: z.string().trim().min(1).max(180),
  representative: z.string().trim().max(180).optional().default(''),
});

export type PetitionParty = z.infer<typeof petitionPartySchema>;

export const petitionChronologyItemSchema = z.object({
  date: z.string().trim().max(24).optional().default(''),
  event: z.string().trim().max(1200).optional().default(''),
  related_evidence: z.string().trim().max(800).optional().default(''),
});

export type PetitionChronologyItem = z.infer<typeof petitionChronologyItemSchema>;

export const petitionGenerateInputSchema = z.object({
  petition_type: z.string().trim().min(1).max(140),
  court_name: z.string().trim().min(1).max(240),
  parties: z.array(petitionPartySchema).min(1).max(20),
  event_summary: z.string().trim().min(1).max(12000),
  chronology: z.array(petitionChronologyItemSchema).max(40).optional().default([]),
  legal_reasons: z.string().trim().max(5000).optional().default(''),
  requests: z.array(z.string().trim().max(1200)).max(40).optional().default([]),
  evidence: z.array(z.string().trim().max(1200)).max(40).optional().default([]),
  attachments: z.array(z.string().trim().max(1200)).max(40).optional().default([]),
  date: z.string().trim().min(1).max(24),
  city: z.string().trim().max(120).optional().default(''),
  signer_name: z.string().trim().max(180).optional().default(''),
  use_ai_refinement: z.boolean().optional().default(true),
  mask_sensitive_data: z.boolean().optional().default(true),
  storage_preference: z.enum(['no_store', 'save_draft']).optional().default('no_store'),
});

export type PetitionGenerateInput = z.infer<typeof petitionGenerateInputSchema>;

export const petitionGenerateOutputSchema = z.object({
  draft_text: z.string(),
  warnings: z.array(z.string()),
  missing_fields: z.array(z.string()),
  confidence_notes: z.array(z.string()),
});

export type PetitionGenerateOutput = z.infer<typeof petitionGenerateOutputSchema>;

export const aiStructuredPetitionSchema = z.object({
  normalized_event_summary: z.string(),
  chronology: z.array(petitionChronologyItemSchema).default([]),
  requests: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  missing_fields: z.array(z.string()).default([]),
});

export type AiStructuredPetition = z.infer<typeof aiStructuredPetitionSchema>;

export const aiVariableBlocksSchema = z.object({
  facts_paragraph: z.string(),
  result_paragraph: z.string(),
  warnings: z.array(z.string()).default([]),
  missing_fields: z.array(z.string()).default([]),
  confidence_notes: z.array(z.string()).default([]),
});

export type AiVariableBlocks = z.infer<typeof aiVariableBlocksSchema>;

export const aiSelfCheckSchema = z.object({
  has_fabrication: z.boolean(),
  issues: z.array(z.string()).default([]),
});

export type AiSelfCheck = z.infer<typeof aiSelfCheckSchema>;
