import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

interface OtpRecord {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

const otpMap = new Map<string, OtpRecord>();
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function timingSafeHexEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function issueOtp(email: string): { sessionId: string; code: string } {
  const sessionId = randomUUID();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const normalizedEmail = normalizeEmail(email);

  otpMap.set(sessionId, {
    email: normalizedEmail,
    codeHash: hashOtp(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  return { sessionId, code };
}

export function verifyOtp(sessionId: string, code: string, email: string): boolean {
  const record = otpMap.get(sessionId);

  if (!record) {
    return false;
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    otpMap.delete(sessionId);
    return false;
  }

  const isExpired = Date.now() > record.expiresAt;
  if (isExpired) {
    otpMap.delete(sessionId);
    return false;
  }

  const normalizedEmail = normalizeEmail(email);
  if (record.email !== normalizedEmail) {
    record.attempts += 1;
    return false;
  }

  const isMatch = timingSafeHexEqual(record.codeHash, hashOtp(code));
  if (isMatch) {
    otpMap.delete(sessionId);
  } else {
    record.attempts += 1;
  }

  return isMatch;
}
