import { ProviderError } from "../types/errors";
import { createHmac, timingSafeEqual } from "node:crypto";

export abstract class BaseMailAdapter {
  protected normalizeHttpError(provider: string, status: number, message: string): ProviderError {
    if (status === 401 || status === 403) {
      return new ProviderError({
        provider,
        code: "TOKEN_EXPIRED",
        message,
        retryable: false,
        status
      });
    }

    if (status === 404) {
      return new ProviderError({
        provider,
        code: "NOT_FOUND",
        message,
        retryable: false,
        status
      });
    }

    if (status === 429) {
      return new ProviderError({
        provider,
        code: "RATE_LIMITED",
        message,
        retryable: true,
        status
      });
    }

    if (status >= 500) {
      return new ProviderError({
        provider,
        code: "NETWORK_ERROR",
        message,
        retryable: true,
        status
      });
    }

    return new ProviderError({
      provider,
      code: "INVALID_REQUEST",
      message,
      retryable: false,
      status
    });
  }

  protected verifyHmacSignature(params: {
    rawBody: string;
    signatureHeader?: string;
    secret?: string;
    provider: string;
  }): void {
    if (!params.secret) {
      return;
    }

    const signature = params.signatureHeader?.trim();
    if (!signature) {
      throw new ProviderError({
        provider: params.provider,
        code: "AUTH_FAILED",
        message: "Webhook imzası eksik",
        retryable: false,
        status: 401
      });
    }

    const computed = createHmac("sha256", params.secret).update(params.rawBody).digest("hex");

    if (!safeCompareHex(computed, signature)) {
      throw new ProviderError({
        provider: params.provider,
        code: "AUTH_FAILED",
        message: "Webhook imza doğrulaması başarısız",
        retryable: false,
        status: 401
      });
    }
  }
}

function safeCompareHex(expectedHex: string, givenHex: string): boolean {
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const given = Buffer.from(givenHex, "hex");

    if (expected.length === 0 || expected.length !== given.length) {
      return false;
    }

    return timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
