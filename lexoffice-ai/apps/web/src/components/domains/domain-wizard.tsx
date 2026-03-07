"use client";

import { useState } from "react";

type Provider = "MANAGED" | "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP";
type Mode = "BYOP" | "MANAGED";

export function DomainWizard({
  tenantId,
  onCreated
}: {
  tenantId: string;
  onCreated: () => Promise<void>;
}) {
  const [domainName, setDomainName] = useState("");
  const [provider, setProvider] = useState<Provider>("MANAGED");
  const [mode, setMode] = useState<Mode>("BYOP");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const response = await fetch("/api/v1/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        domainName,
        provider,
        mode
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Domain eklenemedi");
      setPending(false);
      return;
    }

    setStatus("Domain eklendi. DNS kayıtlarını tanımlayın ve doğrulayın.");
    setDomainName("");
    setPending(false);
    await onCreated();
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold">Domain Onboarding Wizard</h2>
      <ol className="grid gap-1 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 sm:grid-cols-3">
        <li>1. Domain ekle</li>
        <li>2. DNS kayıtlarını gir</li>
        <li>3. Doğrulama çalıştır</li>
      </ol>
      <input
        required
        placeholder="alanadi.com"
        value={domainName}
        onChange={(event) => setDomainName(event.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          Sağlayıcı
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
          >
            <option value="MANAGED">Managed</option>
            <option value="GMAIL">Gmail</option>
            <option value="MICROSOFT_365">Microsoft 365</option>
            <option value="YANDEX">Yandex</option>
            <option value="IMAP_SMTP">IMAP/SMTP</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Mod
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
          >
            <option value="BYOP">Bring Your Own Provider</option>
            <option value="MANAGED">Managed Provisioning</option>
          </select>
        </label>
      </div>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
        {mode === "BYOP"
          ? "BYOP modunda tenant kendi provider hesabını kullanır; OAuth ile mailbox bağlantısı kurulur."
          : "Managed modunda provisioning adapter katmanı üzerinden merkezi yönetim hazırlanır."}
      </p>

      <button
        disabled={pending}
        type="submit"
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Ekleniyor..." : "Domain Ekle"}
      </button>
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </form>
  );
}
