import { z } from "zod";
import { providerEnum } from "./domain";

export const oauthProviderEnum = z.enum(["GMAIL", "MICROSOFT_365", "YANDEX"]);
const mailboxLocalPartSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9._-]+$/i, "Mailbox local part sadece harf, rakam, nokta, tire ve alt çizgi içerebilir");

export const connectMailboxSchema = z.object({
  tenantId: z.string().cuid(),
  provider: providerEnum,
  email: z.string().email(),
  displayName: z.string().min(1).max(120).optional(),
  providerAccountId: z.string().min(2),
  accessToken: z.string().min(8),
  refreshToken: z.string().min(8).optional(),
  scopes: z.array(z.string()).min(1)
});

export const listMailboxesSchema = z.object({
  tenantId: z.string().cuid(),
  provider: providerEnum.optional()
});

export const startMailboxOAuthSchema = z.object({
  tenantId: z.string().cuid(),
  provider: oauthProviderEnum,
  emailHint: z.string().email().optional()
});

export const mailboxWebhookProviderSchema = z.object({
  provider: z.enum(["GMAIL", "MICROSOFT_365", "YANDEX", "IMAP_SMTP"])
});

export const provisionManagedMailboxSchema = z.object({
  tenantId: z.string().cuid(),
  domainId: z.string().cuid(),
  localPart: mailboxLocalPartSchema,
  displayName: z.string().min(1).max(120).optional(),
  provider: providerEnum.default("MANAGED"),
  aliasLocalParts: z.array(mailboxLocalPartSchema).max(20).default([])
});

export type ConnectMailboxInput = z.infer<typeof connectMailboxSchema>;
export type ListMailboxesInput = z.infer<typeof listMailboxesSchema>;
export type StartMailboxOAuthInput = z.infer<typeof startMailboxOAuthSchema>;
export type ProvisionManagedMailboxInput = z.infer<typeof provisionManagedMailboxSchema>;
