import { createHash, randomBytes } from "node:crypto";

export const generateSessionToken = (): string => {
  return randomBytes(48).toString("base64url");
};

export const sha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};
