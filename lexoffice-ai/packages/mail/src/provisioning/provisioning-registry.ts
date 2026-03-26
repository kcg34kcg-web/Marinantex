import { MockProvisioningAdapter } from "./mock-provisioning-adapter";
import type { MailboxProvisioningAdapter, ProvisioningProvider } from "./types";

export class MailboxProvisioningRegistry {
  private readonly adapters: Record<ProvisioningProvider, MailboxProvisioningAdapter>;

  constructor() {
    this.adapters = {
      MANAGED: new MockProvisioningAdapter("MANAGED"),
      GMAIL: new MockProvisioningAdapter("GMAIL"),
      MICROSOFT_365: new MockProvisioningAdapter("MICROSOFT_365"),
      YANDEX: new MockProvisioningAdapter("YANDEX"),
      IMAP_SMTP: new MockProvisioningAdapter("IMAP_SMTP")
    };
  }

  get(provider: ProvisioningProvider): MailboxProvisioningAdapter {
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new Error(`Provisioning adapter bulunamadı: ${provider}`);
    }

    return adapter;
  }

  list(): MailboxProvisioningAdapter[] {
    return Object.values(this.adapters);
  }
}
