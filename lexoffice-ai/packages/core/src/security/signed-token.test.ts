import { describe, expect, it } from "vitest";
import { signPayloadToken, verifyPayloadToken } from "./signed-token";

describe("signed token", () => {
  it("token imzalar ve doğrular", () => {
    const token = signPayloadToken({
      subject: "test",
      payload: {
        foo: "bar"
      },
      ttlSeconds: 60,
      secret: "unit-test-secret"
    });

    const payload = verifyPayloadToken<{ foo: string }>({
      token,
      subject: "test",
      secret: "unit-test-secret"
    });

    expect(payload.foo).toBe("bar");
  });

  it("yanlış secret ile doğrulamaz", () => {
    const token = signPayloadToken({
      subject: "test",
      payload: {
        foo: "bar"
      },
      ttlSeconds: 60,
      secret: "unit-test-secret"
    });

    expect(() =>
      verifyPayloadToken<{ foo: string }>({
        token,
        subject: "test",
        secret: "wrong-secret"
      })
    ).toThrow();
  });
});
