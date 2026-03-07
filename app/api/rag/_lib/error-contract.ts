import { NextResponse } from 'next/server';

export const RAG_PROXY_ERROR_CONTRACT_VERSION = 'rag.proxy.error.v1';
export const RAG_PROXY_ERROR_SCHEMA_VERSION = 'rag.proxy.error.schema.v1';

export interface RagProxyErrorOptions {
  status: number;
  errorCode: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export function ragProxyErrorResponse(options: RagProxyErrorOptions): NextResponse {
  const payload: Record<string, unknown> = {
    error: options.message,
    message: options.message,
    error_code: options.errorCode,
    retryable: Boolean(options.retryable),
    contract_version: RAG_PROXY_ERROR_CONTRACT_VERSION,
    schema_version: RAG_PROXY_ERROR_SCHEMA_VERSION,
  };
  if (options.details && Object.keys(options.details).length > 0) {
    payload.details = options.details;
  }
  return NextResponse.json(payload, { status: options.status });
}
