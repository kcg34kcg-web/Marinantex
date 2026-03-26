import { randomUUID } from "node:crypto";
import type {
  MailboxProvisioningAdapter,
  ProvisionAliasInput,
  ProvisionMailboxInput,
  ProvisionMailboxResult,
  ProvisioningProvider
} from "./types";

export class MockProvisioningAdapter implements MailboxProvisioningAdapter {
  readonly mode = "MOCK" as const;

  constructor(public readonly provider: ProvisioningProvider) {}

  async createMailbox(input: ProvisionMailboxInput): Promise<ProvisionMailboxResult> {
    const status = this.provider === "MANAGED" ? "ACTIVE" : "PENDING";
    const notes =
      this.provider === "MANAGED"
        ? "Mock managed provisioning tamamlandı."
        : "Mock provider provisioning queued.";

    return {
      externalMailboxId: `${this.provider.toLowerCase()}-mbx-${randomUUID()}`,
      status,
      notes: `${notes} email=${input.email}`
    };
  }

  async createAlias(_input: ProvisionAliasInput): Promise<void> {
    return;
  }
}
