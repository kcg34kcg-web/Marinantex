import { describe, expect, it } from "vitest";
import {
  buildOtpAuthUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode
} from "./mfa-totp";

describe("mfa totp", () => {
  it("üretilen kodu doğrular", () => {
    const secret = generateTotpSecret();
    const now = new Date("2026-03-10T10:00:00.000Z");
    const code = generateTotpCode({ secret, at: now });

    expect(verifyTotpCode({ secret, code, now })).toBe(true);
    expect(verifyTotpCode({ secret, code: "000000", now })).toBe(false);
  });

  it("otpauth uri üretir", () => {
    const uri = buildOtpAuthUri({
      issuer: "LexOffice AI",
      accountName: "owner@demo.lexoffice.ai",
      secret: "ABCDEF"
    });

    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("issuer=LexOffice%20AI");
    expect(uri).toContain("secret=ABCDEF");
  });
});
