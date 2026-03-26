import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret-crypto";

const previousMasterKey = process.env.ENCRYPTION_MASTER_KEY;

afterEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = previousMasterKey;
});

describe("secret crypto", () => {
  it("secret değerini şifreleyip çözebilir", () => {
    process.env.ENCRYPTION_MASTER_KEY = Buffer.alloc(32, 1).toString("base64");
    const encrypted = encryptSecret("demo-token");

    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe("demo-token");
  });

  it("legacy plain text tokenı backward compatible çözer", () => {
    process.env.ENCRYPTION_MASTER_KEY = Buffer.alloc(32, 2).toString("base64");
    expect(decryptSecret("plain-token")).toBe("plain-token");
    expect(isEncryptedSecret("plain-token")).toBe(false);
  });
});
