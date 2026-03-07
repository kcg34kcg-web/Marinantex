import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Slug sadece küçük harf, rakam ve tire içerebilir"),
  locale: z.string().default("tr-TR"),
  timezone: z.string().default("Europe/Istanbul")
});

export const inviteMemberSchema = z.object({
  tenantId: z.string().cuid(),
  email: z.string().email(),
  roleCode: z.string().min(2),
  firstName: z.string().min(2).max(80),
  lastName: z.string().min(2).max(80)
});

export const updateTenantProfileSchema = z.object({
  tenantId: z.string().cuid(),
  name: z.string().min(2).max(120),
  locale: z.string().min(2).max(20).optional(),
  timezone: z.string().min(2).max(80).optional()
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateTenantProfileInput = z.infer<typeof updateTenantProfileSchema>;
