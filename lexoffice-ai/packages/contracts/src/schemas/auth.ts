import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantSlug: z.string().min(2).max(80).optional(),
  mfaCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional()
});

export const createSessionSchema = z.object({
  userId: z.string().cuid(),
  tenantId: z.string().cuid().optional(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
  deviceName: z.string().optional()
});

export const startMfaEnrollmentSchema = z.object({
  tenantId: z.string().cuid()
});

export const verifyMfaEnrollmentSchema = z.object({
  tenantId: z.string().cuid(),
  enrollmentToken: z.string().min(32),
  code: z.string().regex(/^\d{6}$/)
});

export const disableMfaSchema = z.object({
  tenantId: z.string().cuid(),
  code: z.string().regex(/^\d{6}$/)
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().cuid()
});

export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyMfaEnrollmentInput = z.infer<typeof verifyMfaEnrollmentSchema>;
export type DisableMfaInput = z.infer<typeof disableMfaSchema>;
export type RevokeSessionInput = z.infer<typeof revokeSessionSchema>;
