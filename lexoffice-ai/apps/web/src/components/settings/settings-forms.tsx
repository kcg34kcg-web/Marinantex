"use client";

import { useEffect, useState } from "react";
import {
  APPEARANCE_CHANGED_EVENT,
  applyAppearancePreferences,
  type DensityPreference,
  getDefaultAppearancePreferences,
  type MailLayoutPreference,
  readAppearancePreferences,
  type ThemePreference,
  writeAppearancePreferences
} from "@/lib/appearance-preferences";
import { withBasePath } from "@/lib/base-path";

type SessionEntry = {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  mfaVerifiedAt: string | null;
  isCurrent: boolean;
};

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
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [densityPreference, setDensityPreference] = useState<DensityPreference>("comfortable");
  const [mailLayoutPreference, setMailLayoutPreference] = useState<MailLayoutPreference>("split");
  const [appearanceStatus, setAppearanceStatus] = useState<string | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);
  const [privacyExportPending, setPrivacyExportPending] = useState(false);
  const [privacyErasePending, setPrivacyErasePending] = useState(false);
  const [privacyEraseReason, setPrivacyEraseReason] = useState("");

  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [disableMfaCode, setDisableMfaCode] = useState("");
  const [mfaEnrollmentToken, setMfaEnrollmentToken] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaOtpAuthUrl, setMfaOtpAuthUrl] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  useEffect(() => {
    const currentAppearance = readAppearancePreferences();
    setThemePreference(currentAppearance.theme);
    setDensityPreference(currentAppearance.density);
    setMailLayoutPreference(currentAppearance.mailLayout);
    void refreshSecurity();
  }, []);

  async function refreshSecurity(): Promise<void> {
    const [meResponse, sessionsResponse] = await Promise.all([
      fetch(withBasePath("/api/v1/auth/me"), { cache: "no-store" }),
      fetch(withBasePath("/api/v1/auth/sessions"), { cache: "no-store" })
    ]);

    const mePayload = (await meResponse.json()) as {
      ok: boolean;
      data?: {
        user: {
          mfaEnabled: boolean;
        };
      };
    };

    const sessionsPayload = (await sessionsResponse.json()) as {
      ok: boolean;
      data?: {
        sessions: SessionEntry[];
      };
    };

    if (mePayload.ok && mePayload.data) {
      setMfaEnabled(mePayload.data.user.mfaEnabled);
    }

    if (sessionsPayload.ok && sessionsPayload.data) {
      setSessions(sessionsPayload.data.sessions);
    }
  }

  async function save(): Promise<void> {
    setPending(true);
    setStatus(null);

    const response = await fetch(withBasePath("/api/v1/settings/tenant"), {
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

  async function startMfa(): Promise<void> {
    setSecurityStatus("MFA kurulumu başlatılıyor...");

    const response = await fetch(withBasePath("/api/v1/auth/mfa/start"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tenantId })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: {
        enrollmentToken: string;
        secret: string;
        otpauthUrl: string;
      };
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      setSecurityStatus(payload.error?.message ?? "MFA kurulumu başlatılamadı");
      return;
    }

    setMfaEnrollmentToken(payload.data.enrollmentToken);
    setMfaSecret(payload.data.secret);
    setMfaOtpAuthUrl(payload.data.otpauthUrl);
    setSecurityStatus("Doğrulama uygulamasında MFA hesabını ekleyin ve 6 haneli kodu girin.");
  }

  async function verifyMfa(): Promise<void> {
    if (!mfaEnrollmentToken || mfaCode.trim().length !== 6) {
      setSecurityStatus("Geçerli bir MFA kodu girin");
      return;
    }

    const response = await fetch(withBasePath("/api/v1/auth/mfa/verify"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        enrollmentToken: mfaEnrollmentToken,
        code: mfaCode.trim()
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "MFA etkinleştirilemedi");
      return;
    }

    setSecurityStatus("MFA başarıyla etkinleştirildi");
    setMfaEnrollmentToken(null);
    setMfaSecret(null);
    setMfaOtpAuthUrl(null);
    setMfaCode("");
    await refreshSecurity();
  }

  async function disableMfa(): Promise<void> {
    if (disableMfaCode.trim().length !== 6) {
      setSecurityStatus("MFA kapatmak için 6 haneli kod girin");
      return;
    }

    const response = await fetch(withBasePath("/api/v1/auth/mfa/disable"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        code: disableMfaCode.trim()
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "MFA devre dışı bırakılamadı");
      return;
    }

    setSecurityStatus("MFA devre dışı bırakıldı");
    setDisableMfaCode("");
    await refreshSecurity();
  }

  async function revokeSession(sessionId: string): Promise<void> {
    const response = await fetch(withBasePath("/api/v1/auth/sessions/revoke"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sessionId })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "Session revoke başarısız");
      return;
    }

    setSecurityStatus("Session sonlandırıldı");
    await refreshSecurity();
  }

  async function revokeOtherSessions(): Promise<void> {
    const response = await fetch(withBasePath("/api/v1/auth/sessions/revoke-others"), {
      method: "POST"
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "Diğer sessionlar sonlandırılamadı");
      return;
    }

    setSecurityStatus("Diğer tüm sessionlar sonlandırıldı");
    await refreshSecurity();
  }

  function saveAppearance(): void {
    const defaults = getDefaultAppearancePreferences();
    const nextAppearance = {
      theme: themePreference ?? defaults.theme,
      density: densityPreference ?? defaults.density,
      mailLayout: mailLayoutPreference ?? defaults.mailLayout
    };

    writeAppearancePreferences(nextAppearance);
    applyAppearancePreferences(nextAppearance);
    window.dispatchEvent(new Event(APPEARANCE_CHANGED_EVENT));
    setAppearanceStatus("Tema ve görünüm ayarları güncellendi");
  }

  async function exportPrivacyData(): Promise<void> {
    setPrivacyExportPending(true);
    setPrivacyStatus(null);

    const response = await fetch(withBasePath("/api/v1/privacy/export"), {
      method: "GET",
      cache: "no-store"
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: unknown;
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      setPrivacyStatus(payload.error?.message ?? "Veri dışa aktarma başarısız");
      setPrivacyExportPending(false);
      return;
    }

    const blob = new Blob([JSON.stringify(payload.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `privacy-export-${tenantId}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setPrivacyStatus("Veri dışa aktarımı hazırlandı ve indirildi");
    setPrivacyExportPending(false);
  }

  async function requestPrivacyErase(): Promise<void> {
    setPrivacyErasePending(true);
    setPrivacyStatus(null);

    const response = await fetch(withBasePath("/api/v1/privacy/erase-request"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: privacyEraseReason.trim() || undefined
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setPrivacyStatus(payload.error?.message ?? "Silme talebi oluşturulamadı");
      setPrivacyErasePending(false);
      return;
    }

    setPrivacyStatus("Silme talebi kaydedildi ve güvenlik loglarına işlendi");
    setPrivacyErasePending(false);
    setPrivacyEraseReason("");
  }

  return (
    <div className="space-y-4">
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

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Tema ve Görünüm</h2>
        <label className="block text-xs text-slate-600">
          Tema
          <select
            value={themePreference}
            onChange={(event) => setThemePreference(event.target.value as ThemePreference)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="system">Sistem</option>
            <option value="light">Açık</option>
            <option value="dark">Koyu</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Yoğunluk
          <select
            value={densityPreference}
            onChange={(event) => setDensityPreference(event.target.value as DensityPreference)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="comfortable">Konforlu</option>
            <option value="compact">Sıkışık</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Mail Yerleşimi
          <select
            value={mailLayoutPreference}
            onChange={(event) => setMailLayoutPreference(event.target.value as MailLayoutPreference)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="split">Bölünmüş</option>
            <option value="list">Liste Odaklı</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
          onClick={saveAppearance}
        >
          Görünüm Ayarlarını Uygula
        </button>
        {appearanceStatus ? <p className="text-xs text-slate-600">{appearanceStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">MFA ve Session Güvenliği</h2>
        <p className="text-xs text-slate-600">MFA durumu: {mfaEnabled ? "Aktif" : "Pasif"}</p>

        {!mfaEnabled ? (
          <div className="space-y-2">
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
              onClick={() => {
                void startMfa();
              }}
            >
              MFA Kurulumu Başlat
            </button>

            {mfaSecret ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-medium">Manuel Secret</p>
                <p className="mt-1 break-all font-mono">{mfaSecret}</p>
                {mfaOtpAuthUrl ? (
                  <a
                    href={mfaOtpAuthUrl}
                    className="mt-2 inline-block text-brand-700 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OTP URL Aç
                  </a>
                ) : null}
              </div>
            ) : null}

            {mfaEnrollmentToken ? (
              <div className="space-y-2">
                <input
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="6 haneli kod"
                  className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-[0.2em]"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white"
                  onClick={() => {
                    void verifyMfa();
                  }}
                >
                  MFA Doğrula ve Etkinleştir
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={disableMfaCode}
              onChange={(event) => setDisableMfaCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="MFA kapatma kodu"
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-[0.2em]"
              inputMode="numeric"
            />
            <button
              type="button"
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700"
              onClick={() => {
                void disableMfa();
              }}
            >
              MFA Devre Dışı Bırak
            </button>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-800">Cihaz / Session Listesi</h3>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-[11px]"
              onClick={() => {
                void revokeOtherSessions();
              }}
            >
              Diğerlerini Sonlandır
            </button>
          </div>

          {sessions.length === 0 ? <p className="text-xs text-slate-500">Aktif session bulunamadı.</p> : null}

          <ul className="space-y-2 text-xs">
            {sessions.map((session) => (
              <li key={session.id} className="rounded border border-slate-100 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">
                    {session.deviceName ?? "Unknown Device"}
                    {session.isCurrent ? " (Mevcut)" : ""}
                  </p>
                  {!session.isCurrent ? (
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-[11px]"
                      onClick={() => {
                        void revokeSession(session.id);
                      }}
                    >
                      Sonlandır
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-slate-600">IP: {session.ipAddress ?? "-"}</p>
                <p className="text-slate-600">MFA: {session.mfaVerifiedAt ? "Doğrulandı" : "Yok"}</p>
                <p className="text-slate-500">Oluşturulma: {new Date(session.createdAt).toLocaleString("tr-TR")}</p>
                <p className="text-slate-500">Sona eriş: {new Date(session.expiresAt).toLocaleString("tr-TR")}</p>
              </li>
            ))}
          </ul>
        </div>

        {securityStatus ? <p className="text-xs text-slate-600">{securityStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">KVKK / GDPR</h2>
        <p className="text-xs text-slate-600">
          Kişisel verilerinizi JSON formatında dışa aktarabilir veya silme talebi oluşturabilirsiniz.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={privacyExportPending}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
            onClick={() => {
              void exportPrivacyData();
            }}
          >
            {privacyExportPending ? "Hazırlanıyor..." : "Verilerimi Dışa Aktar"}
          </button>
        </div>
        <label className="block text-xs text-slate-600">
          Silme talebi nedeni (opsiyonel)
          <textarea
            value={privacyEraseReason}
            onChange={(event) => setPrivacyEraseReason(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Talebinize ek not bırakabilirsiniz."
          />
        </label>
        <button
          type="button"
          disabled={privacyErasePending}
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 disabled:opacity-60"
          onClick={() => {
            void requestPrivacyErase();
          }}
        >
          {privacyErasePending ? "İşleniyor..." : "Silme Talebi Oluştur"}
        </button>
        {privacyStatus ? <p className="text-xs text-slate-600">{privacyStatus}</p> : null}
      </section>
    </div>
  );
}
