const MIN_SECRET_LENGTH = 24;
const WEAK_SECRET_TOKENS = new Set(["dev-change-me", "changeme", "default", "test"]);

export type JwtExpiresIn = `${number}${"s" | "m" | "h" | "d"}` | number;

export function getJwtExpiresIn(): JwtExpiresIn {
  return (process.env.JWT_EXPIRES_IN ?? "15m") as JwtExpiresIn;
}

export function getJwtSecret(): string {
  const token = (process.env.JWT_SECRET ?? "").trim();
  if (!token) {
    throw new Error("JWT_SECRET is required.");
  }

  if (token.length < MIN_SECRET_LENGTH || WEAK_SECRET_TOKENS.has(token.toLowerCase())) {
    throw new Error("JWT_SECRET is missing or too weak. Use a high-entropy secret (min 24 chars).");
  }

  return token;
}
