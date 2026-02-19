'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, GitCompareArrows, Network, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  jurisdictionDiffResponseSchema,
  jurisdictionRuleSetListSchema,
  type JurisdictionDiffResponse,
  type JurisdictionRuleSet,
} from '@/lib/litigation/jurisdiction';
import { ingestResponseSchema, type IngestResponse } from '@/lib/litigation/ingest';
import { chainAuditResponseSchema, type ChainAuditResponse } from '@/lib/litigation/chain-audit';
import { calculateAdvisoryLimitationDate } from '@/lib/litigation/prescription';

const CosmographLiveGraph = dynamic(
  () => import('@/components/dashboard/cosmograph-live-graph').then((module) => module.CosmographLiveGraph),
  {
    ssr: false,
    loading: () => <p className="text-sm text-slate-500">Graf bileşeni yükleniyor...</p>,
  },
);

interface LitigationIntelligencePanelProps {
  caseId: string;
}

async function fetchJurisdictionRuleSets(): Promise<JurisdictionRuleSet[]> {
  const response = await fetch('/api/litigation/jurisdictions', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('Kural setleri alınamadı.');
  }

  const json = await response.json();
  return jurisdictionRuleSetListSchema.parse(json).items;
}

async function fetchJurisdictionDiff(leftCode: string, rightCode: string): Promise<JurisdictionDiffResponse> {
  const query = new URLSearchParams({ leftCode, rightCode });
  const response = await fetch(`/api/litigation/jurisdictions/diff?${query.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Kural seti karşılaştırması alınamadı.');
  }

  const json = await response.json();
  return jurisdictionDiffResponseSchema.parse(json);
}

function randomBase64(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

async function sendDesktopIngest(caseId: string): Promise<IngestResponse> {
  const response = await fetch('/api/litigation/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      caseId,
      ciphertext: randomBase64(96),
      nonce: randomBase64(12),
      authTag: randomBase64(16),
      senderDeviceId: 'desktop-agent-pilot',
      recipientKeyId: 'case-key-v1',
      signature: randomBase64(64),
      sequence: Date.now(),
      sentAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error('Desktop ingest başarısız.');
  }

  const json = await response.json();
  return ingestResponseSchema.parse(json);
}

async function fetchChainAudit(caseId: string): Promise<ChainAuditResponse> {
  const response = await fetch(`/api/litigation/cases/${caseId}/chain/audit`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Chain audit alınamadı.');
  }

  const json = await response.json();
  return chainAuditResponseSchema.parse(json);
}

export function LitigationIntelligencePanel({ caseId }: LitigationIntelligencePanelProps) {
  const [startDate, setStartDate] = useState('2025-01-01');
  const [durationDays, setDurationDays] = useState('365');
  const [accepted, setAccepted] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [ruleSets, setRuleSets] = useState<JurisdictionRuleSet[]>([]);
  const [leftRuleCode, setLeftRuleCode] = useState('');
  const [rightRuleCode, setRightRuleCode] = useState('');
  const [diffResult, setDiffResult] = useState<JurisdictionDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestAck, setIngestAck] = useState<IngestResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<ChainAuditResponse | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadRuleSets = async () => {
      try {
        const result = await fetchJurisdictionRuleSets();

        if (!isMounted) {
          return;
        }

        setRuleSets(result);
        setLeftRuleCode((current) => current || result[0]?.code || '');
        setRightRuleCode((current) => current || result[1]?.code || result[0]?.code || '');
      } catch {
        if (isMounted) {
          setDiffError('Kural setleri yüklenemedi.');
        }
      }
    };

    loadRuleSets();

    return () => {
      isMounted = false;
    };
  }, []);

  const advisory = calculateAdvisoryLimitationDate({
    startDate,
    baseDurationDays: Number(durationDays),
    events: [
      {
        id: 'evt-1',
        caseId,
        eventDate: '2025-06-01',
        eventType: 'tolling_start',
        note: 'Uzlaşma görüşmeleri',
      },
      {
        id: 'evt-2',
        caseId,
        eventDate: '2025-07-01',
        eventType: 'tolling_end',
        note: 'Uzlaşma sona erdi',
      },
    ],
  });

  const acceptAdvisory = async () => {
    const response = await fetch('/api/litigation/limitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        caseId,
        estimatedDate: advisory.estimatedDate,
        accepted,
      }),
    });

    if (!response.ok) {
      setStatusText('Kabul kaydı oluşturulamadı.');
      return;
    }

    setStatusText('Advisory tarih kaydı onaylandı.');
  };

  const compareJurisdictions = async () => {
    if (!leftRuleCode || !rightRuleCode) {
      setDiffError('Karşılaştırma için iki kural seti seçin.');
      setDiffResult(null);
      return;
    }

    if (leftRuleCode === rightRuleCode) {
      setDiffError('Lütfen farklı iki kural seti seçin.');
      setDiffResult(null);
      return;
    }

    setDiffLoading(true);
    setDiffError(null);

    try {
      const result = await fetchJurisdictionDiff(leftRuleCode, rightRuleCode);
      setDiffResult(result);
    } catch {
      setDiffResult(null);
      setDiffError('Kural seti karşılaştırması alınamadı.');
    } finally {
      setDiffLoading(false);
    }
  };

  const runDesktopIngestPilot = async () => {
    setIngestLoading(true);
    setIngestError(null);

    try {
      const ack = await sendDesktopIngest(caseId);
      setIngestAck(ack);
    } catch {
      setIngestAck(null);
      setIngestError('Desktop ingest pilot çağrısı başarısız oldu.');
    } finally {
      setIngestLoading(false);
    }
  };

  const runChainAudit = async () => {
    setAuditLoading(true);
    setAuditError(null);

    try {
      const result = await fetchChainAudit(caseId);
      setAuditResult(result);
    } catch {
      setAuditResult(null);
      setAuditError('Chain audit çağrısı başarısız oldu.');
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-4 w-4 text-blue-600" />
            5D Zamansal Bilgi Grafı Kokpiti
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Bu panel, olgusal tarih ve keşif tarihini ayrıştırarak çelişki analizi üretir.</p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            WebGL/Cosmograph ve Worker tabanlı yerleşim motoru entegrasyonu için mimari hazırlandı.
          </div>
        </CardContent>
      </Card>

      <CosmographLiveGraph caseId={caseId} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Zamanaşımı Motoru (Danışma Niteliğinde)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Input
              value={durationDays}
              onChange={(event) => setDurationDays(event.target.value)}
              placeholder="Süre (gün)"
            />
          </div>
          <p className="text-sm text-slate-700">
            Tahmini Tarih: <strong>{advisory.estimatedDate}</strong>
          </p>
          <p className="text-xs text-orange-700">
            Bu tarih yalnızca "Danışma/Tahmini" niteliktedir. Nihai sorumluluk kullanıcı doğrulamasına tabidir.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            Tarihi inceledim, manuel olarak doğrulayıp kabul ediyorum.
          </label>
          <Button onClick={acceptAdvisory} disabled={!accepted}>
            Kabul & Kayıt Et
          </Button>
          {statusText ? <p className="text-sm text-blue-700">{statusText}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            Delil Bütünlüğü ve Chain of Custody
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p>OCR → Çıkarım → Grafikleme → Bundle Export adımları SHA-256/Merkle kökü ile doğrulanır.</p>
          <Button type="button" variant="outline" onClick={runDesktopIngestPilot} disabled={ingestLoading}>
            {ingestLoading ? 'Pilot gönderiliyor...' : 'Desktop Ingest Pilot'}
          </Button>
          <Button type="button" variant="outline" onClick={runChainAudit} disabled={auditLoading}>
            {auditLoading ? 'Audit çalışıyor...' : 'Chain Audit'}
          </Button>

          {ingestError ? <p className="text-xs text-orange-700">{ingestError}</p> : null}
          {auditError ? <p className="text-xs text-orange-700">{auditError}</p> : null}

          {ingestAck ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
              <p>
                Payload: <strong>{ingestAck.payloadHash.slice(0, 16)}...</strong>
              </p>
              <p>
                Chain: <strong>{ingestAck.chainHash.slice(0, 16)}...</strong>
              </p>
              <p>
                Önceki:{' '}
                <strong>{ingestAck.previousHash ? `${ingestAck.previousHash.slice(0, 16)}...` : 'GENESIS'}</strong>
              </p>
            </div>
          ) : null}

          {auditResult ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
              <p>
                Süreklilik: <strong>{auditResult.isChainContinuous ? 'Geçerli' : 'Sorunlu'}</strong>
              </p>
              <p>
                Toplam: <strong>{auditResult.totalLogs}</strong> · Geçerli Bağ:{' '}
                <strong>{auditResult.validLinkCount}</strong> · Sorun: <strong>{auditResult.brokenLinkCount}</strong>
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-blue-700" />
            Yargı Kural Seti Karşılaştırma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <select
              value={leftRuleCode}
              onChange={(event) => setLeftRuleCode(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            >
              <option value="">Sol kural seti</option>
              {ruleSets.map((ruleSet) => (
                <option key={`left-${ruleSet.code}`} value={ruleSet.code}>
                  {ruleSet.code} · {ruleSet.version}
                </option>
              ))}
            </select>

            <select
              value={rightRuleCode}
              onChange={(event) => setRightRuleCode(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            >
              <option value="">Sağ kural seti</option>
              {ruleSets.map((ruleSet) => (
                <option key={`right-${ruleSet.code}`} value={ruleSet.code}>
                  {ruleSet.code} · {ruleSet.version}
                </option>
              ))}
            </select>

            <Button type="button" variant="outline" onClick={compareJurisdictions} disabled={diffLoading}>
              {diffLoading ? 'Karşılaştırılıyor...' : 'Karşılaştır'}
            </Button>
          </div>

          {diffError ? <p className="text-xs text-orange-700">{diffError}</p> : null}

          {diffResult ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-700">
                {diffResult.left.code} ({diffResult.left.version}) ↔ {diffResult.right.code} ({diffResult.right.version}
                )
              </p>
              <p className="text-xs text-slate-600">
                Karşılaştırılan alan: <strong>{diffResult.comparedFieldCount}</strong> · Fark:{' '}
                <strong>{diffResult.differenceCount}</strong>
              </p>

              <div className="max-h-48 overflow-auto rounded border border-slate-200 bg-white">
                {diffResult.differences.length === 0 ? (
                  <p className="p-2 text-xs text-slate-500">Fark bulunamadı.</p>
                ) : (
                  diffResult.differences.map((item) => (
                    <div key={item.path} className="border-b border-slate-100 p-2 text-xs last:border-b-0">
                      <p className="font-semibold text-slate-800">{item.path}</p>
                      <p className="text-slate-500">Sol: {JSON.stringify(item.leftValue)}</p>
                      <p className="text-slate-500">Sağ: {JSON.stringify(item.rightValue)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
