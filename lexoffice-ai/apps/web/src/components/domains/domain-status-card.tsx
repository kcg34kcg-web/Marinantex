"use client";

import { useState } from "react";

type DomainCard = {
  id: string;
  domainName: string;
  status: string;
  provider: string | null;
  onboardingMode: string;
  dnsRecords: Array<{
    id: string;
    type: string;
    host: string;
    value: string;
    verified: boolean;
    required: boolean;
    priority: number | null;
  }>;
};

export function DomainStatusCard({
  tenantId,
  domain,
  onVerified
}: {
  tenantId: string;
  domain: DomainCard;
  onVerified: () => Promise<void>;
}) {
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  async function verify(): Promise<void> {
    setVerifying(true);
    setVerifyMessage(null);

    const response = await fetch(`/api/v1/domains/${domain.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId })
    });

    const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
    if (!payload.ok) {
      setVerifyMessage(payload.error?.message ?? "DNS doğrulama başarısız");
      setVerifying(false);
      return;
    }

    setVerifyMessage("DNS doğrulaması tamamlandı, durum güncellendi.");
    setVerifying(false);
    await onVerified();
  }

  const statusLabel = mapDomainStatus(domain.status);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{domain.domainName}</h3>
          <p className="text-xs text-slate-500">
            {domain.provider ?? "MANAGED"} / {domain.onboardingMode}
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs ${statusLabel.className}`}>
          {statusLabel.label}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">Tip</th>
              <th className="px-3 py-2">Host</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Durum</th>
            </tr>
          </thead>
          <tbody>
            {domain.dnsRecords.map((record) => (
              <tr key={record.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{record.type}</td>
                <td className="px-3 py-2">{record.host}</td>
                <td className="max-w-[320px] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <code className="max-w-[240px] truncate rounded bg-slate-100 px-1.5 py-0.5">
                      {record.value}
                    </code>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
                      onClick={() => {
                        void navigator.clipboard.writeText(record.value);
                      }}
                    >
                      Kopyala
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      record.verified
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {record.verified ? "Doğrulandı" : "Bekliyor"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        disabled={verifying}
        className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
        onClick={() => {
          void verify();
        }}
      >
        {verifying ? "Doğrulanıyor..." : "DNS Doğrulamayı Çalıştır"}
      </button>
      {verifyMessage ? <p className="mt-2 text-xs text-slate-600">{verifyMessage}</p> : null}
    </article>
  );
}

function mapDomainStatus(status: string): { label: string; className: string } {
  if (status === "MAIL_READY") {
    return { label: "Mail Ready", className: "bg-emerald-100 text-emerald-700" };
  }

  if (status === "VERIFIED") {
    return { label: "Doğrulandı", className: "bg-sky-100 text-sky-700" };
  }

  if (status === "MISCONFIGURED") {
    return { label: "Hatalı Konfigürasyon", className: "bg-rose-100 text-rose-700" };
  }

  if (status === "SUSPENDED") {
    return { label: "Askıya Alındı", className: "bg-slate-200 text-slate-700" };
  }

  return { label: "Doğrulama Bekleniyor", className: "bg-amber-100 text-amber-700" };
}
