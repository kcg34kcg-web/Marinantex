interface OtpRecord {
  email: string;
  code: string;
  expiresAt: number;
}

const otpMap = new Map<string, OtpRecord>();

export function issueOtp(email: string): { sessionId: string; code: string } {
  const sessionId = crypto.randomUUID();
  const code = String(Math.floor(100000 + Math.random() * 900000));

  otpMap.set(sessionId, {
    email,
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return { sessionId, code };
}

export function verifyOtp(sessionId: string, code: string): boolean {
  const record = otpMap.get(sessionId);

  if (!record) {
    return false;
  }

  const isExpired = Date.now() > record.expiresAt;
  if (isExpired) {
    otpMap.delete(sessionId);
    return false;
  }

  const isMatch = record.code === code;
  if (isMatch) {
    otpMap.delete(sessionId);
  }

  return isMatch;
}
