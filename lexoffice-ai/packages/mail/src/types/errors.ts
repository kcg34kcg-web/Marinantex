export type NormalizedProviderErrorCode =
  | "AUTH_FAILED"
  | "TOKEN_EXPIRED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class ProviderError extends Error {
  readonly code: NormalizedProviderErrorCode;
  readonly retryable: boolean;
  readonly provider: string;
  readonly status: number | undefined;

  constructor(params: {
    code: NormalizedProviderErrorCode;
    message: string;
    retryable: boolean;
    provider: string;
    status?: number;
  }) {
    super(params.message);
    this.name = "ProviderError";
    this.code = params.code;
    this.retryable = params.retryable;
    this.provider = params.provider;
    this.status = params.status;
  }
}
