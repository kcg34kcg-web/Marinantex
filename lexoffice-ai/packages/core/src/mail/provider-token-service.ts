import type { PrismaClient } from "@lexoffice/db";
import { MailProviderRegistry, type SupportedMailProvider } from "@lexoffice/mail";
import { UnauthorizedError } from "../errors/app-error";
import { decryptSecret, encryptSecret } from "../security/secret-crypto";

const REFRESH_GRACE_MS = 2 * 60 * 1000;

type ConnectionForToken = {
  id: string;
  provider: "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED";
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
};

export class ProviderTokenService {
  private readonly providerRegistry: MailProviderRegistry;

  constructor(private readonly prisma: PrismaClient) {
    this.providerRegistry = new MailProviderRegistry();
  }

  async resolveAccessToken(connection: ConnectionForToken): Promise<string> {
    const currentAccessToken = decryptSecret(connection.accessTokenEncrypted);
    if (connection.provider === "MANAGED" || !this.shouldRefresh(connection.tokenExpiresAt)) {
      return currentAccessToken;
    }

    const refreshToken = connection.refreshTokenEncrypted
      ? decryptSecret(connection.refreshTokenEncrypted)
      : null;
    if (!refreshToken) {
      await this.markConnectionExpired(connection.id, "Refresh token mevcut değil");
      throw new UnauthorizedError("Provider token süresi doldu. Mailbox yeniden bağlanmalı.");
    }

    const adapter = this.providerRegistry.get(connection.provider as SupportedMailProvider);

    try {
      const refreshed = await adapter.refreshToken(refreshToken);
      const encryptedAccessToken = encryptSecret(refreshed.accessToken);
      const encryptedRefreshToken = refreshed.refreshToken
        ? encryptSecret(refreshed.refreshToken)
        : connection.refreshTokenEncrypted;

      await this.prisma.mailboxConnection.update({
        where: { id: connection.id },
        data: {
          accessTokenEncrypted: encryptedAccessToken,
          ...(encryptedRefreshToken === null
            ? {}
            : { refreshTokenEncrypted: encryptedRefreshToken }),
          tokenExpiresAt: refreshed.expiresAt ?? null,
          scopes: refreshed.scopes.length > 0 ? refreshed.scopes : connection.scopes,
          status: "CONNECTED",
          lastError: null
        }
      });

      return refreshed.accessToken;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Provider token refresh işlemi başarısız";
      await this.markConnectionExpired(connection.id, message);
      throw new UnauthorizedError("Provider token yenilenemedi. Mailbox yeniden bağlanmalı.");
    }
  }

  private shouldRefresh(expiresAt: Date | null): boolean {
    if (!expiresAt) {
      return false;
    }

    return expiresAt.getTime() - Date.now() <= REFRESH_GRACE_MS;
  }

  private async markConnectionExpired(connectionId: string, reason: string): Promise<void> {
    await this.prisma.mailboxConnection.update({
      where: { id: connectionId },
      data: {
        status: "TOKEN_EXPIRED",
        lastError: reason
      }
    });
  }
}
