import { z } from 'zod';

const base64LikeRegex = /^[A-Za-z0-9+/=]+$/;

export const encryptedEnvelopeSchema = z.object({
  caseId: z.string().uuid(),
  ciphertext: z.string().min(32).regex(base64LikeRegex),
  nonce: z.string().min(8).regex(base64LikeRegex),
  authTag: z.string().min(8).regex(base64LikeRegex),
  senderDeviceId: z.string().min(3),
  recipientKeyId: z.string().min(3),
  signature: z.string().min(16).regex(base64LikeRegex),
  sequence: z.number().int().positive(),
  sentAt: z.string().datetime(),
});

export const ingestResponseSchema = z.object({
  accepted: z.literal(true),
  caseId: z.string().uuid(),
  stage: z.literal('ocr'),
  payloadHash: z.string().min(1),
  chainHash: z.string().min(1),
  previousHash: z.string().nullable(),
  receivedAt: z.string().datetime(),
});

export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
