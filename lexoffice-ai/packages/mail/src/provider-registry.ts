import { GmailProviderAdapter } from "./adapters/gmail-provider-adapter";
import { ImapSmtpAdapter } from "./adapters/imap-smtp-adapter";
import { MicrosoftGraphMailAdapter } from "./adapters/microsoft-graph-mail-adapter";
import { YandexMailAdapter } from "./adapters/yandex-mail-adapter";
import type { MailProviderAdapter } from "./types/provider-types";

export type SupportedMailProvider = Exclude<MailProviderAdapter["provider"], "MANAGED">;

export class MailProviderRegistry {
  private readonly adapters: Record<SupportedMailProvider, MailProviderAdapter>;

  constructor() {
    this.adapters = {
      GMAIL: new GmailProviderAdapter(),
      MICROSOFT_365: new MicrosoftGraphMailAdapter(),
      YANDEX: new YandexMailAdapter(),
      IMAP_SMTP: new ImapSmtpAdapter()
    };
  }

  get(provider: SupportedMailProvider): MailProviderAdapter {
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new Error(`Desteklenmeyen provider: ${provider}`);
    }

    return adapter;
  }

  list(): MailProviderAdapter[] {
    return Object.values(this.adapters);
  }
}
