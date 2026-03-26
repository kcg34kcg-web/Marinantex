import { describe, expect, it } from "vitest";
import { MailboxProvisioningRegistry } from "./provisioning-registry";

describe("MailboxProvisioningRegistry", () => {
  it("tüm provisioning adapterlarını döndürür", async () => {
    const registry = new MailboxProvisioningRegistry();
    const adapters = registry.list();

    expect(adapters.map((adapter) => adapter.provider)).toEqual(
      expect.arrayContaining(["MANAGED", "GMAIL", "MICROSOFT_365", "YANDEX", "IMAP_SMTP"])
    );

    const result = await registry.get("MANAGED").createMailbox({
      tenantId: "tenant-1",
      domain: "example.com",
      email: "info@example.com"
    });

    expect(result.externalMailboxId).toContain("managed-mbx");
  });
});
