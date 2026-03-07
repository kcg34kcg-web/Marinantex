import { afterEach, describe, expect, it } from "vitest";
import { createMailOAuthState, verifyMailOAuthState } from "./mail-oauth-state";

const previousSecret = process.env.AUTH_SECRET;

afterEach(() => {
  process.env.AUTH_SECRET = previousSecret;
});

describe("mail oauth state", () => {
  it("state üretip doğrular", () => {
    process.env.AUTH_SECRET = "test-secret";

    const state = createMailOAuthState({
      tenantId: "cmabc123tenant001",
      tenantSlug: "demo-hukuk",
      userId: "cmabc123user001",
      provider: "GMAIL",
      emailHint: "owner@demo.lexoffice.ai"
    });

    const parsed = verifyMailOAuthState(state);
    expect(parsed.provider).toBe("GMAIL");
    expect(parsed.tenantSlug).toBe("demo-hukuk");
    expect(parsed.emailHint).toBe("owner@demo.lexoffice.ai");
  });

  it("imza bozulduğunda hata verir", () => {
    process.env.AUTH_SECRET = "test-secret";

    const state = createMailOAuthState({
      tenantId: "cmabc123tenant001",
      tenantSlug: "demo-hukuk",
      userId: "cmabc123user001",
      provider: "YANDEX"
    });

    const tampered = `${state}x`;
    expect(() => verifyMailOAuthState(tampered)).toThrow();
  });
});
