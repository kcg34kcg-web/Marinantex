"use client";

import { useCallback, useEffect, useState } from "react";
import { DomainWizard } from "./domain-wizard";
import { DomainStatusCard } from "./domain-status-card";

type DomainResponse = {
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

export function DomainManagementPanel({ tenantId }: { tenantId: string }) {
  const [domains, setDomains] = useState<DomainResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDomains = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/v1/domains?tenantId=${tenantId}`, {
      cache: "no-store"
    });
    const payload = (await response.json()) as { ok: boolean; data?: { domains: DomainResponse[] } };

    setDomains(payload.data?.domains ?? []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  return (
    <div className="space-y-4">
      <DomainWizard tenantId={tenantId} onCreated={loadDomains} />
      {loading ? <p className="text-sm text-slate-500">Yükleniyor...</p> : null}
      {domains.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Domain henüz eklenmedi.
        </div>
      ) : null}
      <div className="grid gap-4">
        {domains.map((domain) => (
          <DomainStatusCard key={domain.id} tenantId={tenantId} domain={domain} onVerified={loadDomains} />
        ))}
      </div>
    </div>
  );
}
