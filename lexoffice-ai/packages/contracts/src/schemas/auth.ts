import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantSlug: z.string().min(2).max(80).optional()
});

export const createSessionSchema = z.object({
  userId: z.string().cuid(),
  tenantId: z.string().cuid().optional(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
  deviceName: z.string().optional()
});

export type LoginInput = z.infer<typeof loginSchema>;
