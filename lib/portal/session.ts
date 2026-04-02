import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/utils/supabase/admin';

const PORTAL_ACCESS_COOKIE = 'portal_access_token';
const PORTAL_REFRESH_COOKIE = 'portal_refresh_token';
const PORTAL_SESSION_COOKIE = 'portal_session_id';
const PORTAL_DEVICE_COOKIE = 'portal_device_id';
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TTL_DAYS = 30;

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

interface PortalSessionTokenPayload {
  typ: 'portal_access' | 'portal_refresh';
  sid: string;
  sub: string;
  tid: string;
  did: string;
  iat: number;
  exp: number;
  jti?: string;
}

interface PortalSessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  refresh_token_hash: string;
  device_id: string;
  device_name: string | null;
  ip_address: string | null;
  user_agent_hash: string | null;
  two_factor_method: string | null;
  two_factor_verified_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string;
  created_at: string;
}

export interface PortalIssuedSession {
  sessionId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  persisted: boolean;
}

export interface PortalSessionCookieBundle {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  deviceId: string;
}

export interface PortalValidatedSession {
  valid: boolean;
  reason?: string;
  sessionId?: string;
  deviceId?: string;
  persisted?: boolean;
}

interface CookieStoreLike {
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string): void;
  get(name: string): { value: string } | undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function resolveAccessTtlSeconds() {
  return parsePositiveInt(process.env.PORTAL_SESSION_ACCESS_TTL_SECONDS, DEFAULT_ACCESS_TTL_SECONDS);
}

function resolveRefreshTtlDays() {
  return parsePositiveInt(process.env.PORTAL_SESSION_REFRESH_TTL_DAYS, DEFAULT_REFRESH_TTL_DAYS);
}

function resolveSessionJwtSecret() {
  return (
    process.env.PORTAL_SESSION_JWT_SECRET?.trim() ||
    process.env.PORTAL_SIGNED_URL_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    'portal-session-dev-secret'
  );
}

function base64UrlEncode(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signJwtPart(input: string) {
  return createHmac('sha256', resolveSessionJwtSecret()).update(input).digest('base64url');
}

function parseTokenPayload<T>(token: string): T | null {
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signJwtPart(`${encodedHeader}.${encodedPayload}`);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader)) as JwtHeader;
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }
  } catch {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(encodedPayload)) as T;
  } catch {
    return null;
  }
}

function createToken(payload: PortalSessionTokenPayload): string {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signJwtPart(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function toIsoFromEpochSeconds(epoch: number) {
  return new Date(epoch * 1000).toISOString();
}

function hashUserAgent(userAgent: string | null | undefined) {
  return createHash('sha256').update((userAgent ?? '').trim() || 'unknown').digest('hex');
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function safeTokenHashMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isSessionsTableMissing(error: unknown) {
  const code = (error as { code?: string } | null | undefined)?.code;
  return code === '42P01';
}

function resolveDeviceName(input: { userAgent: string | null; preferredDeviceName?: string | null }) {
  const explicit = input.preferredDeviceName?.trim();
  if (explicit) {
    return explicit.slice(0, 160);
  }

  const fallback = (input.userAgent ?? '').trim();
  if (!fallback) {
    return 'Unknown device';
  }

  return fallback.slice(0, 160);
}

function ensurePortalDeviceId(cookieStore: CookieStoreLike) {
  const current = cookieStore.get(PORTAL_DEVICE_COOKIE)?.value?.trim();
  if (current) {
    return current;
  }

  const generated = randomUUID();
  cookieStore.set(PORTAL_DEVICE_COOKIE, generated, {
    path: '/',
    sameSite: 'lax',
    secure: isProduction(),
    httpOnly: true,
    maxAge: 365 * 24 * 60 * 60,
  });
  return generated;
}

function createAccessTokenPayload(input: {
  sessionId: string;
  userId: string;
  tenantId: string;
  deviceId: string;
  accessTtlSeconds: number;
}) {
  const issuedAt = nowEpochSeconds();
  const expiresAt = issuedAt + Math.max(60, input.accessTtlSeconds);
  return {
    payload: {
      typ: 'portal_access' as const,
      sid: input.sessionId,
      sub: input.userId,
      tid: input.tenantId,
      did: input.deviceId,
      iat: issuedAt,
      exp: expiresAt,
    },
    expiresAtIso: toIsoFromEpochSeconds(expiresAt),
  };
}

function createRefreshTokenPayload(input: {
  sessionId: string;
  userId: string;
  tenantId: string;
  deviceId: string;
  refreshTtlDays: number;
}) {
  const issuedAt = nowEpochSeconds();
  const expiresAt = issuedAt + Math.max(1, input.refreshTtlDays) * 24 * 60 * 60;
  return {
    payload: {
      typ: 'portal_refresh' as const,
      sid: input.sessionId,
      sub: input.userId,
      tid: input.tenantId,
      did: input.deviceId,
      iat: issuedAt,
      exp: expiresAt,
      jti: randomBytes(18).toString('base64url'),
    },
    expiresAtIso: toIsoFromEpochSeconds(expiresAt),
  };
}

export function getPortalSessionCookies(cookieStore: CookieStoreLike): {
  accessToken: string | null;
  refreshToken: string | null;
  sessionId: string | null;
  deviceId: string | null;
} {
  return {
    accessToken: cookieStore.get(PORTAL_ACCESS_COOKIE)?.value ?? null,
    refreshToken: cookieStore.get(PORTAL_REFRESH_COOKIE)?.value ?? null,
    sessionId: cookieStore.get(PORTAL_SESSION_COOKIE)?.value ?? null,
    deviceId: cookieStore.get(PORTAL_DEVICE_COOKIE)?.value ?? null,
  };
}

export function setPortalSessionCookies(cookieStore: CookieStoreLike, input: PortalSessionCookieBundle) {
  const accessTtlSeconds = resolveAccessTtlSeconds();
  const refreshTtlSeconds = resolveRefreshTtlDays() * 24 * 60 * 60;
  const common = {
    path: '/',
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
  };

  cookieStore.set(PORTAL_ACCESS_COOKIE, input.accessToken, {
    ...common,
    maxAge: accessTtlSeconds,
  });
  cookieStore.set(PORTAL_REFRESH_COOKIE, input.refreshToken, {
    ...common,
    maxAge: refreshTtlSeconds,
  });
  cookieStore.set(PORTAL_SESSION_COOKIE, input.sessionId, {
    ...common,
    maxAge: refreshTtlSeconds,
  });
  cookieStore.set(PORTAL_DEVICE_COOKIE, input.deviceId, {
    ...common,
    maxAge: 365 * 24 * 60 * 60,
  });
}

export function clearPortalSessionCookies(cookieStore: CookieStoreLike) {
  const options = {
    path: '/',
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
  };
  cookieStore.delete(PORTAL_ACCESS_COOKIE);
  cookieStore.delete(PORTAL_REFRESH_COOKIE);
  cookieStore.delete(PORTAL_SESSION_COOKIE);
  cookieStore.delete('portal_2fa_verified');
  cookieStore.set(PORTAL_ACCESS_COOKIE, '', { ...options, maxAge: 0 });
  cookieStore.set(PORTAL_REFRESH_COOKIE, '', { ...options, maxAge: 0 });
  cookieStore.set(PORTAL_SESSION_COOKIE, '', { ...options, maxAge: 0 });
  cookieStore.set('portal_2fa_verified', '', { ...options, maxAge: 0 });
}

export async function issuePortalSession(input: {
  userId: string;
  tenantId: string;
  cookieStore: CookieStoreLike;
  ipAddress: string | null;
  userAgent: string | null;
  preferredDeviceName?: string | null;
  twoFactorMethod?: string | null;
}): Promise<PortalIssuedSession> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const deviceId = ensurePortalDeviceId(input.cookieStore);
  const accessTtlSeconds = resolveAccessTtlSeconds();
  const refreshTtlDays = resolveRefreshTtlDays();

  let sessionId = randomUUID();
  let persisted = true;

  const existingResult = await admin
    .from('sessions')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('user_id', input.userId)
    .eq('device_id', deviceId)
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingResult.error && !isSessionsTableMissing(existingResult.error)) {
    throw existingResult.error;
  }

  if (isSessionsTableMissing(existingResult.error)) {
    persisted = false;
  } else if (existingResult.data?.id) {
    sessionId = existingResult.data.id;
  }

  const accessTokenPack = createAccessTokenPayload({
    sessionId,
    userId: input.userId,
    tenantId: input.tenantId,
    deviceId,
    accessTtlSeconds,
  });
  const refreshTokenPack = createRefreshTokenPayload({
    sessionId,
    userId: input.userId,
    tenantId: input.tenantId,
    deviceId,
    refreshTtlDays,
  });
  const accessToken = createToken(accessTokenPack.payload);
  const refreshToken = createToken(refreshTokenPack.payload);
  const refreshTokenHash = hashToken(refreshToken);

  if (persisted) {
    const payload = {
      tenant_id: input.tenantId,
      user_id: input.userId,
      refresh_token_hash: refreshTokenHash,
      device_id: deviceId,
      device_name: resolveDeviceName({ userAgent: input.userAgent, preferredDeviceName: input.preferredDeviceName }),
      ip_address: input.ipAddress,
      user_agent_hash: hashUserAgent(input.userAgent),
      two_factor_method: input.twoFactorMethod ?? 'email_otp',
      two_factor_verified_at: nowIso,
      last_seen_at: nowIso,
      expires_at: refreshTokenPack.expiresAtIso,
      revoked_at: null,
      revoked_reason: null,
    };

    const persistResult = existingResult.data?.id
      ? await admin.from('sessions').update(payload).eq('id', existingResult.data.id)
      : await admin.from('sessions').insert({
          id: sessionId,
          created_at: nowIso,
          ...payload,
        });

    if (persistResult.error && !isSessionsTableMissing(persistResult.error)) {
      throw persistResult.error;
    }

    if (isSessionsTableMissing(persistResult.error)) {
      persisted = false;
    }
  }

  return {
    sessionId,
    deviceId,
    accessToken,
    refreshToken,
    accessExpiresAt: accessTokenPack.expiresAtIso,
    refreshExpiresAt: refreshTokenPack.expiresAtIso,
    persisted,
  };
}

function verifySessionToken(
  token: string,
  expectedType: 'portal_access' | 'portal_refresh',
): PortalSessionTokenPayload | null {
  const payload = parseTokenPayload<PortalSessionTokenPayload>(token);
  if (!payload) {
    return null;
  }

  if (
    payload.typ !== expectedType ||
    !payload.sid ||
    !payload.sub ||
    !payload.tid ||
    !payload.did ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }

  if (payload.exp <= nowEpochSeconds()) {
    return null;
  }

  return payload;
}

export async function validatePortalAccessSession(input: {
  accessToken: string;
  expectedUserId: string;
  expectedTenantId: string;
}): Promise<PortalValidatedSession> {
  const payload = verifySessionToken(input.accessToken, 'portal_access');
  if (!payload) {
    return { valid: false, reason: 'invalid_access_token' };
  }

  if (payload.sub !== input.expectedUserId || payload.tid !== input.expectedTenantId) {
    return { valid: false, reason: 'scope_mismatch' };
  }

  const admin = createAdminClient();
  const sessionResult = await admin
    .from('sessions')
    .select('id, revoked_at, expires_at, device_id')
    .eq('id', payload.sid)
    .eq('tenant_id', input.expectedTenantId)
    .eq('user_id', input.expectedUserId)
    .maybeSingle();

  if (sessionResult.error && !isSessionsTableMissing(sessionResult.error)) {
    throw sessionResult.error;
  }

  if (isSessionsTableMissing(sessionResult.error)) {
    return {
      valid: true,
      sessionId: payload.sid,
      deviceId: payload.did,
      persisted: false,
    };
  }

  if (!sessionResult.data || sessionResult.data.revoked_at) {
    return { valid: false, reason: 'session_revoked_or_missing' };
  }

  if (new Date(sessionResult.data.expires_at).getTime() <= Date.now()) {
    return { valid: false, reason: 'session_expired' };
  }

  return {
    valid: true,
    sessionId: sessionResult.data.id,
    deviceId: sessionResult.data.device_id ?? payload.did,
    persisted: true,
  };
}

export async function rotatePortalRefreshSession(input: {
  refreshToken: string;
  expectedUserId: string;
  expectedTenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<PortalIssuedSession | null> {
  const payload = verifySessionToken(input.refreshToken, 'portal_refresh');
  if (!payload) {
    return null;
  }

  if (payload.sub !== input.expectedUserId || payload.tid !== input.expectedTenantId) {
    return null;
  }

  const admin = createAdminClient();
  const sessionResult = await admin
    .from('sessions')
    .select(
      'id, tenant_id, user_id, device_id, device_name, refresh_token_hash, expires_at, revoked_at, two_factor_method',
    )
    .eq('id', payload.sid)
    .eq('tenant_id', payload.tid)
    .eq('user_id', payload.sub)
    .maybeSingle();

  if (sessionResult.error && isSessionsTableMissing(sessionResult.error)) {
    return null;
  }

  if (sessionResult.error) {
    throw sessionResult.error;
  }

  const session = sessionResult.data as PortalSessionRow | null;
  if (!session || session.revoked_at) {
    return null;
  }

  if (!safeTokenHashMatch(hashToken(input.refreshToken), session.refresh_token_hash)) {
    return null;
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    return null;
  }

  const accessTtlSeconds = resolveAccessTtlSeconds();
  const refreshTtlDays = resolveRefreshTtlDays();
  const accessTokenPack = createAccessTokenPayload({
    sessionId: session.id,
    userId: session.user_id,
    tenantId: session.tenant_id,
    deviceId: session.device_id,
    accessTtlSeconds,
  });
  const refreshTokenPack = createRefreshTokenPayload({
    sessionId: session.id,
    userId: session.user_id,
    tenantId: session.tenant_id,
    deviceId: session.device_id,
    refreshTtlDays,
  });
  const accessToken = createToken(accessTokenPack.payload);
  const refreshToken = createToken(refreshTokenPack.payload);
  const nowIso = new Date().toISOString();

  const updateResult = await admin
    .from('sessions')
    .update({
      refresh_token_hash: hashToken(refreshToken),
      ip_address: input.ipAddress,
      user_agent_hash: hashUserAgent(input.userAgent),
      last_seen_at: nowIso,
      expires_at: refreshTokenPack.expiresAtIso,
      revoked_at: null,
      revoked_reason: null,
      two_factor_verified_at: nowIso,
    })
    .eq('id', session.id);

  if (updateResult.error && !isSessionsTableMissing(updateResult.error)) {
    throw updateResult.error;
  }

  return {
    sessionId: session.id,
    deviceId: session.device_id,
    accessToken,
    refreshToken,
    accessExpiresAt: accessTokenPack.expiresAtIso,
    refreshExpiresAt: refreshTokenPack.expiresAtIso,
    persisted: !isSessionsTableMissing(updateResult.error),
  };
}

export async function listPortalSessions(input: {
  userId: string;
  tenantId: string;
}): Promise<Array<{
  id: string;
  deviceId: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}>> {
  const admin = createAdminClient();
  const result = await admin
    .from('sessions')
    .select('id, device_id, device_name, ip_address, last_seen_at, created_at, expires_at, revoked_at')
    .eq('tenant_id', input.tenantId)
    .eq('user_id', input.userId)
    .order('last_seen_at', { ascending: false })
    .limit(50);

  if (result.error && isSessionsTableMissing(result.error)) {
    return [];
  }

  if (result.error) {
    throw result.error;
  }

  return (result.data ?? []).map((item) => ({
    id: item.id,
    deviceId: item.device_id,
    deviceName: item.device_name,
    ipAddress: item.ip_address,
    lastSeenAt: item.last_seen_at,
    createdAt: item.created_at,
    expiresAt: item.expires_at,
    revokedAt: item.revoked_at,
  }));
}

export async function revokePortalSessionById(input: {
  sessionId: string;
  userId: string;
  tenantId: string;
  reason: string;
}) {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const result = await admin
    .from('sessions')
    .update({
      revoked_at: nowIso,
      revoked_reason: input.reason,
      last_seen_at: nowIso,
    })
    .eq('id', input.sessionId)
    .eq('tenant_id', input.tenantId)
    .eq('user_id', input.userId)
    .is('revoked_at', null);

  if (result.error && !isSessionsTableMissing(result.error)) {
    throw result.error;
  }
}

export async function revokePortalSessionsExcept(input: {
  sessionIdToKeep: string;
  userId: string;
  tenantId: string;
  reason: string;
}) {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const result = await admin
    .from('sessions')
    .update({
      revoked_at: nowIso,
      revoked_reason: input.reason,
      last_seen_at: nowIso,
    })
    .eq('tenant_id', input.tenantId)
    .eq('user_id', input.userId)
    .neq('id', input.sessionIdToKeep)
    .is('revoked_at', null);

  if (result.error && !isSessionsTableMissing(result.error)) {
    throw result.error;
  }
}

export async function revokePortalSessionByRefreshToken(input: {
  refreshToken: string | null;
  userId: string;
  tenantId: string;
  reason: string;
}) {
  if (!input.refreshToken) {
    return;
  }

  const payload = verifySessionToken(input.refreshToken, 'portal_refresh');
  if (!payload || payload.sub !== input.userId || payload.tid !== input.tenantId) {
    return;
  }

  await revokePortalSessionById({
    sessionId: payload.sid,
    userId: input.userId,
    tenantId: input.tenantId,
    reason: input.reason,
  });
}

