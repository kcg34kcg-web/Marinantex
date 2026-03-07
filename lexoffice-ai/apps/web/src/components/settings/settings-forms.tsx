"use client";

import { useState } from "react";

export function SettingsForms({
  tenantId,
  tenantName,
  locale,
  timezone
}: {
  tenantId: string;
  tenantName: string;
  locale: string;
  timezone: string;
}) {
  const [name, setName] = useState(tenantName);
  const [selectedLocale, setSelectedLocale] = useState(locale);
  const [selectedTimezone, setSelectedTimezone] = useState(timezone);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save(): Promise<void> {
    setPending(true);
    setStatus(null);

    const response = await fetch("/api/v1/settings/tenant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        name,
        locale: selectedLocale,
        timezone: selectedTimezone
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Ayarlar kaydedilemedi");
      setPending(false);
      return;
    }

    setStatus("Ayarlar kaydedildi");
    setPending(false);
  }

  return (
    <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Tenant Settings</h2>
      <label className="block text-xs text-slate-600">
        Tenant Adı
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-xs text-slate-600">
        Dil
        <select
          value={selectedLocale}
          onChange={(event) => setSelectedLocale(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="tr-TR">Türkçe (TR)</option>
          <option value="en-US">English (US)</option>
        </select>
      </label>
      <label className="block text-xs text-slate-600">
        Zaman Dilimi
        <select
          value={selectedTimezone}
          onChange={(event) => setSelectedTimezone(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="Europe/Istanbul">Europe/Istanbul</option>
          <option value="UTC">UTC</option>
          <option value="Europe/London">Europe/London</option>
          <option value="America/New_York">America/New_York</option>
        </select>
      </label>
      <button
        type="button"
        className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
        disabled={pending}
        onClick={() => {
          void save();
        }}
      >
        {pending ? "Kaydediliyor..." : "Kaydet"}
      </button>
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </form>
  );
}
