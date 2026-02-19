import { z } from 'zod';

export const PetitionSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
      citations: z.array(z.string()),
    })
  ),
});

export type PetitionObject = z.infer<typeof PetitionSchema>;

export const modelHealthSchema = z.object({
  ok: z.boolean(),
});

export type ModelHealth = z.infer<typeof modelHealthSchema>;
