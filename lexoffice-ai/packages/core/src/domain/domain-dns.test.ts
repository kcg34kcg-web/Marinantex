import { describe, expect, it } from "vitest";
import { buildDomainDnsTemplate } from "./domain-dns";

describe("buildDomainDnsTemplate", () => {
  it("managed provider için gerekli MX/SPF/DKIM/DMARC kayıtlarını üretir", () => {
    const records = buildDomainDnsTemplate({
      domainName: "example.com",
      provider: "MANAGED",
      verificationToken: "token-123"
    });

    expect(records.some((record) => record.type === "TXT" && record.host === "_lexoffice-verification")).toBe(true);
    expect(records.some((record) => record.type === "SPF")).toBe(true);
    expect(records.some((record) => record.type === "DKIM")).toBe(true);
    expect(records.some((record) => record.type === "DMARC")).toBe(true);
    expect(records.some((record) => record.type === "MX" && record.value === "mx1.lexoffice.ai")).toBe(true);
  });

  it("gmail provider için google mx kaydı üretir", () => {
    const records = buildDomainDnsTemplate({
      domainName: "example.com",
      provider: "GMAIL",
      verificationToken: "token-123"
    });

    expect(records.some((record) => record.type === "MX" && record.value === "aspmx.l.google.com")).toBe(true);
    expect(records.some((record) => record.type === "SPF" && record.value.includes("_spf.google.com"))).toBe(true);
  });
});
