import { describe, expect, it } from "vitest";
import { MailProviderRegistry } from "../provider-registry";

describe("provider adapters", () => {
  it("tüm adapterlar temel operasyonları çalıştırır", async () => {
    const registry = new MailProviderRegistry();
    const adapters = registry.list();

    for (const adapter of adapters) {
      const authUrl = adapter.buildAuthorizationUrl({
        redirectUri: "http://localhost:3000/api/v1/integrations/mail/oauth/callback",
        state: "test-state",
        loginHint: "owner@demo.lexoffice.ai"
      });
      expect(authUrl).toContain("state=test-state");

      const auth = await adapter.connect("owner@demo.lexoffice.ai", "http://localhost/callback");
      expect(auth.email).toContain("@");
      expect(auth.accessToken.length).toBeGreaterThan(10);

      const profile = await adapter.getProfile(auth.accessToken);
      expect(profile.email).toContain("@");

      const mailboxes = await adapter.listMailboxes(auth.accessToken);
      expect(mailboxes.length).toBeGreaterThan(0);

      const sync = await adapter.syncMessages(auth.accessToken, {
        mailboxId: "mailbox-1"
      });
      expect(sync.messages.length).toBeGreaterThan(0);

      const sendResult = await adapter.sendMessage(auth.accessToken, {
        mailboxId: "mailbox-1",
        subject: "Test",
        bodyText: "Hello",
        to: ["target@example.com"]
      });
      expect(sendResult.providerMessageId).toContain("sent");

      const webhookEvents = await adapter.parseWebhookEvent({
        rawBody: JSON.stringify({
          events: [{ providerAccountId: auth.providerAccountId, eventType: "MESSAGE_RECEIVED" }]
        }),
        headers: {}
      });
      expect(webhookEvents.length).toBe(1);
    }
  });
});
