import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

interface PortalSignedDownloadPayload {
  type: 'portal_document_download';
  tenantId: string;
  userId: string;
  caseId: string;
  documentId: string;
  nonce: string;
  exp: number;
}

function resolveSigningSecret(): string {
  return (
    process.env.PORTAL_SIGNED_URL_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    'portal-dev-secret'
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(rawPayload: string): string {
  return createHmac('sha256', resolveSigningSecret()).update(rawPayload).digest('base64url');
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createPortalSignedDownloadToken(input: {
  tenantId: string;
  userId: string;
  caseId: string;
  documentId: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: string } {
  const ttlSeconds = Math.max(30, Math.trunc(input.ttlSeconds ?? 300));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: PortalSignedDownloadPayload = {
    type: 'portal_document_download',
    tenantId: input.tenantId,
    userId: input.userId,
    caseId: input.caseId,
    documentId: input.documentId,
    nonce: randomUUID(),
    exp,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyPortalSignedDownloadToken(token: string): {
  valid: boolean;
  reason?: 'malformed' | 'invalid_signature' | 'expired' | 'invalid_payload';
  payload?: PortalSignedDownloadPayload;
} {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return { valid: false, reason: 'malformed' };
  }

  const expected = sign(encodedPayload);
  if (!timingSafeTextEqual(signature, expected)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  let parsedPayload: PortalSignedDownloadPayload;
  try {
    parsedPayload = JSON.parse(base64UrlDecode(encodedPayload)) as PortalSignedDownloadPayload;
  } catch {
    return { valid: false, reason: 'invalid_payload' };
  }

  if (
    parsedPayload.type !== 'portal_document_download' ||
    !parsedPayload.tenantId ||
    !parsedPayload.userId ||
    !parsedPayload.caseId ||
    !parsedPayload.documentId ||
    !parsedPayload.nonce ||
    !Number.isFinite(parsedPayload.exp)
  ) {
    return { valid: false, reason: 'invalid_payload' };
  }

  if (Math.floor(Date.now() / 1000) > parsedPayload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return {
    valid: true,
    payload: parsedPayload,
  };
}

