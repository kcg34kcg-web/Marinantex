const MIN_SECRET_LENGTH = 24;
const WEAK_SECRET_TOKENS = new Set(["dev-change-me", "changeme", "default", "test"]);
const DEV_FALLBACK_JWT_SECRET = "benim_cok_gizli_ve_kirilmasi_imkansiz_jwt_sifrem_2026!";

export type JwtExpiresIn = `${number}${"s" | "m" | "h" | "d"}` | number;

export function getJwtExpiresIn(): JwtExpiresIn {
  return (process.env.JWT_EXPIRES_IN ?? "15m") as JwtExpiresIn;
}

export function getJwtSecret(): string {
  const token = (process.env.JWT_SECRET ?? "").trim();
  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[api] JWT_SECRET tanimli degil. Development fallback anahtari kullaniliyor.");
      return DEV_FALLBACK_JWT_SECRET;
    }
    throw new Error("JWT_SECRET is required.");
  }

  if (token.length < MIN_SECRET_LENGTH || WEAK_SECRET_TOKENS.has(token.toLowerCase())) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[api] JWT_SECRET zayif. Development fallback anahtari kullaniliyor.");
      return DEV_FALLBACK_JWT_SECRET;
    }
    throw new Error("JWT_SECRET is missing or too weak. Use a high-entropy secret (min 24 chars).");
  }

  return token;
}
