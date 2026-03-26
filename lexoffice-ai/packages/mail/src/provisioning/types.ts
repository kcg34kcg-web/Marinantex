export type ProvisioningProvider = "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED";

export type ProvisionMailboxInput = {
  tenantId: string;
  domain: string;
  email: string;
  displayName?: string;
};

export type ProvisionMailboxResult = {
  externalMailboxId: string;
  status: "PENDING" | "ACTIVE";
  notes?: string;
};

export type ProvisionAliasInput = {
  tenantId: string;
  mailboxEmail: string;
  aliasEmail: string;
};

export interface MailboxProvisioningAdapter {
  readonly provider: ProvisioningProvider;
  readonly mode: "MOCK" | "LIVE";

  createMailbox(input: ProvisionMailboxInput): Promise<ProvisionMailboxResult>;
  createAlias(input: ProvisionAliasInput): Promise<void>;
}
