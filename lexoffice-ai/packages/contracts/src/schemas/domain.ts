import { z } from "zod";

export const providerEnum = z.enum(["GMAIL", "MICROSOFT_365", "YANDEX", "IMAP_SMTP", "MANAGED"]);
export const domainOnboardingModeEnum = z.enum(["BYOP", "MANAGED"]);

export const addDomainSchema = z.object({
  tenantId: z.string().cuid(),
  domainName: z
    .string()
    .min(4)
    .max(255)
    .regex(/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/),
  provider: providerEnum.default("MANAGED"),
  mode: domainOnboardingModeEnum.default("BYOP")
});

export const verifyDomainSchema = z.object({
  tenantId: z.string().cuid(),
  domainId: z.string().cuid()
});

export const listDomainsSchema = z.object({
  tenantId: z.string().cuid(),
  status: z
    .enum(["PENDING_VERIFICATION", "VERIFIED", "MAIL_READY", "MISCONFIGURED", "SUSPENDED"])
    .optional()
});

export type AddDomainInput = z.infer<typeof addDomainSchema>;
export type VerifyDomainInput = z.infer<typeof verifyDomainSchema>;
export type ListDomainsInput = z.infer<typeof listDomainsSchema>;
