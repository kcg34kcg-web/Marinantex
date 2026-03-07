import { describe, expect, it } from "vitest";
import { MailProviderRegistry } from "./provider-registry";

describe("MailProviderRegistry", () => {
  it("tüm sağlayıcı adapterlarını listeler", () => {
    const registry = new MailProviderRegistry();
    const providers = registry.list().map((adapter) => adapter.provider);

    expect(providers).toContain("GMAIL");
    expect(providers).toContain("MICROSOFT_365");
    expect(providers).toContain("YANDEX");
    expect(providers).toContain("IMAP_SMTP");
  });

  it("geçersiz provider için hata fırlatır", () => {
    const registry = new MailProviderRegistry();

    expect(() => registry.get("UNKNOWN" as never)).toThrow("Desteklenmeyen provider");
  });
});
