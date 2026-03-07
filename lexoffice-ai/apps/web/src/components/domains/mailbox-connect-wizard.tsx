"use client";

import { useState } from "react";

type Provider = "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED";

export function MailboxConnectWizard({
  tenantId,
  tenantSlug,
  oauthStatus,
  onConnected
}: {
  tenantId: string;
  tenantSlug: string;
  oauthStatus?: {
    state: "success" | "error";
    provider?: string;
    mailbox?: string;
    reason?: string;
  };
  onConnected?: () => Promise<void>;
}) {
  const [provider, setProvider] = useState<Provider>("GMAIL");
  const [email, setEmail] = useState("info@demo-hukuk.com");
  const [displayName, setDisplayName] = useState("Demo Mailbox");
  const [accessToken, setAccessToken] = useState("mock-access-token");
  const [refreshToken, setRefreshToken] = useState("mock-refresh-token");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function startOAuth(): Promise<void> {
    setPending(true);
    setStatus(null);

    const params = new URLSearchParams({
      tenantId,
      provider
    });

    if (email) {
      params.set("emailHint", email);
    }

    const response = await fetch(`/api/v1/integrations/mail/oauth/start?${params.toString()}`, {
      method: "GET"
    });
    const payload = (await response.json()) as {
      ok: boolean;
      data?: { authorizationUrl: string };
      error?: { message: string };
    };

    if (!payload.ok || !payload.data?.authorizationUrl) {
      setPending(false);
      setStatus(payload.error?.message ?? "OAuth akışı başlatılamadı");
      return;
    }

    window.location.assign(payload.data.authorizationUrl);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const isOAuthProvider =
      provider === "GMAIL" || provider === "MICROSOFT_365" || provider === "YANDEX";
    if (isOAuthProvider) {
      await startOAuth();
      return;
    }

    const response = await fetch("/api/v1/mailboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        provider,
        email,
        displayName,
        providerAccountId: `${provider.toLowerCase()}-${email.toLowerCase()}`,
        accessToken,
        refreshToken,
        scopes: ["mail.read", "mail.send", "mail.modify"]
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Mailbox bağlanamadı");
      setPending(false);
      return;
    }

    setStatus("Mailbox bağlantısı kuruldu. Senkronizasyon başlatabilirsiniz.");
    setPending(false);
    if (onConnected) {
      await onConnected();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold">Mailbox Connect Wizard</h2>
      {oauthStatus ? (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            oauthStatus.state === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-rose-300 bg-rose-50 text-rose-700"
          }`}
        >
          {oauthStatus.state === "success"
            ? `${oauthStatus.provider ?? "Provider"} mailbox bağlantısı tamamlandı: ${oauthStatus.mailbox ?? "-"}`
            : `OAuth bağlantısı başarısız: ${oauthStatus.reason ?? "Bilinmeyen hata"}`}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          Provider
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
          >
            <option value="GMAIL">Gmail</option>
            <option value="MICROSOFT_365">Microsoft 365</option>
            <option value="YANDEX">Yandex</option>
            <option value="IMAP_SMTP">IMAP/SMTP</option>
            <option value="MANAGED">Managed</option>
          </select>
        </label>

        <label className="text-xs text-slate-600">
          Display Name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block text-xs text-slate-600">
        Email
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
        />
      </label>

      {provider === "IMAP_SMTP" || provider === "MANAGED" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-600">
            Access Token
            <input
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Refresh Token
            <input
              value={refreshToken}
              onChange={(event) => setRefreshToken(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          OAuth yönlendirmesi ile güvenli bağlantı kurulacaktır. Callback sonrası bu sayfaya
          döneceksiniz.
        </p>
      )}

      <button
        disabled={pending}
        type="submit"
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending
          ? "İşleniyor..."
          : provider === "IMAP_SMTP" || provider === "MANAGED"
            ? "Mailbox Bağla"
            : "OAuth ile Bağla"}
      </button>
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
      <p className="text-[11px] text-slate-500">Tenant: {tenantSlug}</p>
    </form>
  );
}
