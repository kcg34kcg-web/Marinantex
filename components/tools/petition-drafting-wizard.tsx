'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileSignature,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  buildDeterministicPetitionDraft,
  collectGuardrailWarnings,
  normalizePetitionInput,
} from '@/lib/petition-wizard/engine';
import {
  petitionGenerateOutputSchema,
  type PetitionGenerateInput,
  type PetitionGenerateOutput,
  type PetitionPartyRole,
} from '@/lib/petition-wizard/types';

const STEP_TITLES = [
  'Mahkeme ve Tur',
  'Taraf Bilgileri',
  'Olay Ozeti',
  'Talepler',
  'Deliller ve Ekler',
  'Onizleme',
] as const;

const PETITION_TYPES = [
  'Dava Dilekcesi',
  'Cevap Dilekcesi',
  'Sikayet Dilekcesi',
  'Itiraz Dilekcesi',
  'Beyan Dilekcesi',
  'Tespit Dilekcesi',
] as const;

const ROLE_OPTIONS: Array<{ value: PetitionPartyRole; label: string }> = [
  { value: 'davaci', label: 'Davaci' },
  { value: 'davali', label: 'Davali' },
  { value: 'sikayetci', label: 'Sikayetci' },
  { value: 'supheli', label: 'Supheli' },
  { value: 'magdur', label: 'Magdur' },
  { value: 'katilan', label: 'Katilan' },
  { value: 'vekil', label: 'Vekil' },
  { value: 'diger', label: 'Diger' },
];

const MISSING_LABELS: Record<string, string> = {
  petition_type: 'Dilekce turu',
  court_name: 'Mahkeme adi',
  event_summary: 'Olay ozeti',
  event_summary_detail: 'Olay ozeti (daha ayrintili)',
  date: 'Tarih',
  requests: 'Talepler',
  evidence: 'Deliller',
  attachments: 'Ekler',
  chronology: 'Kronoloji',
  parties: 'Taraf bilgileri',
  claimant_party: 'Davaci/Sikayetci tarafi',
  counter_party: 'Karsi taraf',
};

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function createInitialForm(): PetitionGenerateInput {
  return {
    petition_type: '',
    court_name: '',
    parties: [
      { role: 'davaci', name: '', representative: '' },
      { role: 'davali', name: '', representative: '' },
    ],
    event_summary: '',
    chronology: [{ date: '', event: '', related_evidence: '' }],
    legal_reasons: '',
    requests: [''],
    evidence: [''],
    attachments: [''],
    date: getTodayIsoDate(),
    city: '',
    signer_name: '',
    use_ai_refinement: true,
    mask_sensitive_data: true,
    storage_preference: 'no_store',
  };
}

function formatStepErrors(step: number, input: PetitionGenerateInput): string[] {
  const normalized = normalizePetitionInput(input);

  if (step === 0) {
    const errors: string[] = [];
    if (!normalized.petition_type) errors.push('Dilekce turu secilmeli.');
    if (!normalized.court_name || normalized.court_name.length < 5) {
      errors.push('Mahkeme adi en az 5 karakter olmali.');
    }
    if (!normalized.date) errors.push('Tarih zorunludur.');
    return errors;
  }

  if (step === 1) {
    const errors: string[] = [];
    if (normalized.parties.length === 0) errors.push('En az bir taraf eklenmeli.');
    if (!normalized.parties.some((party) => party.role === 'davali' || party.role === 'supheli')) {
      errors.push('Karsi taraf (davali/supheli) bilgisi eksik.');
    }
    return errors;
  }

  if (step === 2) {
    const errors: string[] = [];
    if (!normalized.event_summary) errors.push('Olay ozeti zorunludur.');
    if (normalized.event_summary.length > 0 && normalized.event_summary.length < 100) {
      errors.push('Olay ozeti en az 100 karakter olmali.');
    }
    return errors;
  }

  if (step === 3) {
    const errors: string[] = [];
    if (normalized.requests.length === 0) errors.push('En az bir talep eklenmeli.');
    if (normalized.requests.some((item) => item.length < 10)) {
      errors.push('Her talep en az 10 karakter olmali.');
    }
    return errors;
  }

  return [];
}

function allBlockingErrors(input: PetitionGenerateInput): Array<{ step: number; message: string }> {
  const blockingSteps = [0, 1, 2, 3];
  return blockingSteps.flatMap((step) => formatStepErrors(step, input).map((message) => ({ step, message })));
}

export function PetitionDraftingWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<PetitionGenerateInput>(() => createInitialForm());
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [result, setResult] = useState<PetitionGenerateOutput | null>(null);
  const [editableDraftText, setEditableDraftText] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const normalized = useMemo(() => normalizePetitionInput(form), [form]);
  const localDeterministicPreview = useMemo(() => buildDeterministicPetitionDraft(normalized), [normalized]);
  const combinedWarnings = result?.warnings ?? localDeterministicPreview.warnings;
  const combinedMissing = result?.missing_fields ?? localDeterministicPreview.missing_fields;
  const displayedDraftText = editableDraftText || result?.draft_text || localDeterministicPreview.draft_text;

  const stepProgress = ((stepIndex + 1) / STEP_TITLES.length) * 100;

  function setField<Key extends keyof PetitionGenerateInput>(key: Key, value: PetitionGenerateInput[Key]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function updateParty(index: number, patch: Partial<PetitionGenerateInput['parties'][number]>) {
    setForm((previous) => ({
      ...previous,
      parties: previous.parties.map((party, partyIndex) =>
        partyIndex === index ? { ...party, ...patch } : party,
      ),
    }));
  }

  function addParty() {
    setForm((previous) => ({
      ...previous,
      parties: [...previous.parties, { role: 'diger', name: '', representative: '' }],
    }));
  }

  function removeParty(index: number) {
    setForm((previous) => ({
      ...previous,
      parties: previous.parties.filter((_, partyIndex) => partyIndex !== index),
    }));
  }

  function updateChronology(index: number, patch: Partial<PetitionGenerateInput['chronology'][number]>) {
    setForm((previous) => ({
      ...previous,
      chronology: previous.chronology.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function addChronologyItem() {
    setForm((previous) => ({
      ...previous,
      chronology: [...previous.chronology, { date: '', event: '', related_evidence: '' }],
    }));
  }

  function removeChronologyItem(index: number) {
    setForm((previous) => ({
      ...previous,
      chronology: previous.chronology.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function updateStringList(
    key: 'requests' | 'evidence' | 'attachments',
    index: number,
    nextValue: string,
  ) {
    setForm((previous) => ({
      ...previous,
      [key]: previous[key].map((item, itemIndex) => (itemIndex === index ? nextValue : item)),
    }));
  }

  function addStringListItem(key: 'requests' | 'evidence' | 'attachments') {
    setForm((previous) => ({
      ...previous,
      [key]: [...previous[key], ''],
    }));
  }

  function removeStringListItem(key: 'requests' | 'evidence' | 'attachments', index: number) {
    setForm((previous) => ({
      ...previous,
      [key]: previous[key].filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function nextStep() {
    const errors = formatStepErrors(stepIndex, form);
    setStepErrors(errors);
    if (errors.length > 0) {
      return;
    }
    setStepErrors([]);
    setStepIndex((previous) => Math.min(previous + 1, STEP_TITLES.length - 1));
  }

  function previousStep() {
    setStepErrors([]);
    setStepIndex((previous) => Math.max(previous - 1, 0));
  }

  async function generateDraft() {
    setActionMessage(null);
    const blocking = allBlockingErrors(form);
    if (blocking.length > 0) {
      const first = blocking[0];
      setStepIndex(first.step);
      setStepErrors([first.message]);
      setActionMessage('Taslak uretilmeden once zorunlu alanlari tamamlayin.');
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch('/api/petition-wizard/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizePetitionInput(form)),
      });

      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const errorMessage =
          payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Dilekce taslagi olusturulamadi.';
        setActionMessage(errorMessage);
        return;
      }

      const parsed = petitionGenerateOutputSchema.safeParse(payload);
      if (!parsed.success) {
        setActionMessage('Servis yaniti beklenen formatta degil.');
        return;
      }

      setResult(parsed.data);
      setEditableDraftText(parsed.data.draft_text);
      setActionMessage('Taslak olusturuldu. Onizleme alaninda duzenleyebilirsiniz.');
      setStepIndex(5);
    } catch {
      setActionMessage('Taslak uretimi sirasinda ag hatasi olustu.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyDraft() {
    if (!displayedDraftText.trim()) {
      setActionMessage('Kopyalanacak metin bulunamadi.');
      return;
    }

    setIsCopying(true);
    try {
      await navigator.clipboard.writeText(displayedDraftText);
      setActionMessage('Taslak panoya kopyalandi.');
    } catch {
      setActionMessage('Kopyalama basarisiz oldu.');
    } finally {
      setIsCopying(false);
    }
  }

  function downloadDraft() {
    if (!displayedDraftText.trim()) {
      setActionMessage('Indirilecek metin bulunamadi.');
      return;
    }

    const blob = new Blob([displayedDraftText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateLabel = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    link.href = url;
    link.download = `dilekce-taslagi-${dateLabel}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setActionMessage('Taslak indirildi.');
  }

  function missingFieldLabel(field: string): string {
    return MISSING_LABELS[field] ?? field;
  }

  return (
    <section className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-[var(--primary)]" />
            Dilekce Sihirbazi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-[var(--secondary)]">
              <span>Adim {stepIndex + 1} / {STEP_TITLES.length}</span>
              <span>{STEP_TITLES[stepIndex]}</span>
            </div>
            <div className="h-2 rounded-full bg-[color-mix(in_srgb,var(--surface),black_10%)]">
              <div className="h-2 rounded-full bg-[var(--primary)] transition-all" style={{ width: `${stepProgress}%` }} />
            </div>
            <div className="mt-3 grid gap-1 md:grid-cols-6">
              {STEP_TITLES.map((title, index) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => setStepIndex(index)}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-left text-xs transition-colors',
                    index === stepIndex
                      ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_12%)] text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--secondary)] hover:bg-[color-mix(in_srgb,var(--surface),var(--primary)_8%)]',
                  )}
                >
                  {index + 1}. {title}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="mb-1 inline-flex items-center gap-2 font-medium">
              <ShieldAlert className="h-4 w-4" />
              Hassas Bilgi Uyarisi
            </div>
            <p>
              Zorunlu olmadikca TCKN, tam adres, IBAN, telefon gibi hassas verileri girmeyin. Varsayilan
              depolama tercihi: kayit yok.
            </p>
          </div>

          {stepIndex === 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Dilekce Turu (zorunlu)</span>
                <select
                  value={form.petition_type}
                  onChange={(event) => setField('petition_type', event.target.value)}
                  className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                >
                  <option value="">Seciniz</option>
                  {PETITION_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Mahkeme Adi (zorunlu)</span>
                <Input
                  value={form.court_name}
                  onChange={(event) => setField('court_name', event.target.value)}
                  placeholder="Orn: Istanbul Anadolu 5. Is Mahkemesi"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Tarih (zorunlu)</span>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) => setField('date', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Sehir (opsiyonel)</span>
                <Input
                  value={form.city}
                  onChange={(event) => setField('city', event.target.value)}
                  placeholder="Orn: Istanbul"
                />
              </label>
            </div>
          ) : null}

          {stepIndex === 1 ? (
            <div className="space-y-3">
              {form.parties.map((party, index) => (
                <div key={`party-${index}`} className="grid gap-2 rounded-xl border border-[var(--border)] p-3 md:grid-cols-12">
                  <select
                    value={party.role}
                    onChange={(event) => updateParty(index, { role: event.target.value as PetitionPartyRole })}
                    className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm md:col-span-3"
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <Input
                    className="md:col-span-4"
                    value={party.name}
                    onChange={(event) => updateParty(index, { name: event.target.value })}
                    placeholder="Orn: Ahmet Y."
                  />
                  <Input
                    className="md:col-span-4"
                    value={party.representative ?? ''}
                    onChange={(event) => updateParty(index, { representative: event.target.value })}
                    placeholder="Vekil bilgisi (opsiyonel)"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="md:col-span-1"
                    onClick={() => removeParty(index)}
                    disabled={form.parties.length <= 1}
                  >
                    Sil
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addParty}>Taraf Ekle</Button>
            </div>
          ) : null}

          {stepIndex === 2 ? (
            <div className="space-y-3">
              <label className="space-y-1 text-sm">
                <span>Olay Ozeti (zorunlu)</span>
                <Textarea
                  className="min-h-[180px]"
                  value={form.event_summary}
                  onChange={(event) => setField('event_summary', event.target.value)}
                  placeholder="Orn: 12.01.2026 tarihinde ... Kronolojiyi net ve tarih bazli yazin."
                />
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium">Kronoloji (opsiyonel ama onerilir)</p>
                {form.chronology.map((item, index) => (
                  <div key={`chronology-${index}`} className="grid gap-2 rounded-xl border border-[var(--border)] p-3 md:grid-cols-12">
                    <Input
                      className="md:col-span-3"
                      type="date"
                      value={item.date}
                      onChange={(event) => updateChronology(index, { date: event.target.value })}
                    />
                    <Input
                      className="md:col-span-5"
                      value={item.event}
                      onChange={(event) => updateChronology(index, { event: event.target.value })}
                      placeholder="Olay"
                    />
                    <Input
                      className="md:col-span-3"
                      value={item.related_evidence ?? ''}
                      onChange={(event) => updateChronology(index, { related_evidence: event.target.value })}
                      placeholder="Ilgili delil"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="md:col-span-1"
                      onClick={() => removeChronologyItem(index)}
                      disabled={form.chronology.length <= 1}
                    >
                      Sil
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addChronologyItem}>Satir Ekle</Button>
              </div>
            </div>
          ) : null}

          {stepIndex === 3 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Talepler (zorunlu)</p>
              {form.requests.map((request, index) => (
                <div key={`request-${index}`} className="flex gap-2">
                  <Input
                    value={request}
                    onChange={(event) => updateStringList('requests', index, event.target.value)}
                    placeholder="Orn: Yargilama giderlerinin davaliya yukletilmesine karar verilmesi"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => removeStringListItem('requests', index)}
                    disabled={form.requests.length <= 1}
                  >
                    Sil
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => addStringListItem('requests')}>
                Talep Ekle
              </Button>

              <label className="space-y-1 text-sm">
                <span>Hukuki Sebepler (opsiyonel)</span>
                <Textarea
                  value={form.legal_reasons}
                  onChange={(event) => setField('legal_reasons', event.target.value)}
                  placeholder='Kullanici belirtmezse "Ilgili mevzuat hukumleri" yazilir.'
                />
              </label>
            </div>
          ) : null}

          {stepIndex === 4 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Deliller</p>
                {form.evidence.map((evidenceItem, index) => (
                  <div key={`evidence-${index}`} className="flex gap-2">
                    <Input
                      value={evidenceItem}
                      onChange={(event) => updateStringList('evidence', index, event.target.value)}
                      placeholder="Orn: WhatsApp yazismasi ekran goruntusu"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeStringListItem('evidence', index)}
                      disabled={form.evidence.length <= 1}
                    >
                      Sil
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={() => addStringListItem('evidence')}>
                  Delil Ekle
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Ekler</p>
                {form.attachments.map((attachment, index) => (
                  <div key={`attachment-${index}`} className="flex gap-2">
                    <Input
                      value={attachment}
                      onChange={(event) => updateStringList('attachments', index, event.target.value)}
                      placeholder="Orn: Vekaletname sureti"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeStringListItem('attachments', index)}
                      disabled={form.attachments.length <= 1}
                    >
                      Sil
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={() => addStringListItem('attachments')}>
                  Ek Ekle
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>Imzalayan (opsiyonel)</span>
                  <Input
                    value={form.signer_name}
                    onChange={(event) => setField('signer_name', event.target.value)}
                    placeholder="Orn: Ahmet Y."
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>Saklama Tercihi</span>
                  <select
                    value={form.storage_preference}
                    onChange={(event) => setField('storage_preference', event.target.value as PetitionGenerateInput['storage_preference'])}
                    className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                  >
                    <option value="no_store">Kayit Yok (Varsayilan)</option>
                    <option value="save_draft">Taslagi Kaydet (Opsiyonel)</option>
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.mask_sensitive_data}
                  onChange={(event) => setField('mask_sensitive_data', event.target.checked)}
                />
                Hassas verileri otomatik maskele
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.use_ai_refinement}
                  onChange={(event) => setField('use_ai_refinement', event.target.checked)}
                />
                AI ile degisken bloklari iyilestir (hibrit mod)
              </label>
            </div>
          ) : null}

          {stepIndex === 5 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={generateDraft} disabled={isGenerating} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  {isGenerating ? 'Taslak Uretiliyor...' : 'Taslagi Uret / Yenile'}
                </Button>
                <Button variant="outline" onClick={copyDraft} disabled={isCopying || !displayedDraftText.trim()} className="gap-2">
                  <Copy className="h-4 w-4" />
                  Kopyala
                </Button>
                <Button variant="outline" onClick={downloadDraft} disabled={!displayedDraftText.trim()} className="gap-2">
                  <Download className="h-4 w-4" />
                  Indir
                </Button>
              </div>

              <label className="space-y-1 text-sm">
                <span>Onizleme ve Duzenleme</span>
                <Textarea
                  className="min-h-[420px] font-mono text-xs"
                  value={displayedDraftText}
                  onChange={(event) => setEditableDraftText(event.target.value)}
                  placeholder="Taslak burada gorunecek..."
                />
              </label>
            </div>
          ) : null}

          {stepErrors.length > 0 ? (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              <div className="mb-1 inline-flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Zorunlu Alan Uyarilari
              </div>
              <ul className="list-disc pl-5">
                {stepErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {actionMessage ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
              {actionMessage}
            </div>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-2">
            <Card className="border-[var(--border)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Eksik Bilgi Uyarilari</CardTitle>
              </CardHeader>
              <CardContent>
                {combinedMissing.length === 0 ? (
                  <p className="inline-flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    Kritik eksik alan bulunmuyor.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm text-amber-800">
                    {combinedMissing.map((field) => (
                      <li key={field}>- {missingFieldLabel(field)}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="border-[var(--border)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Kontrol ve Risk Uyarilari</CardTitle>
              </CardHeader>
              <CardContent>
                {combinedWarnings.length === 0 ? (
                  <p className="text-sm text-[var(--secondary)]">Uyari bulunmuyor.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-[var(--text)]">
                    {combinedWarnings.map((warning) => (
                      <li key={warning}>- {warning}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_5%)] px-3 py-2 text-xs text-[var(--secondary)]">
            {collectGuardrailWarnings(normalized).slice(0, 1).map((item) => (
              <p key={item}>{item}</p>
            ))}
            <p>
              Bu taslak hukuki danismanlik degildir. Mahkemeye sunmadan once manuel kontrol ve uzman
              incelemesi onerilir.
            </p>
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={previousStep} disabled={stepIndex === 0}>
              Geri
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={generateDraft} disabled={isGenerating}>
                Hizli Taslak
              </Button>
              <Button onClick={nextStep} disabled={stepIndex >= STEP_TITLES.length - 1}>
                Ileri
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
