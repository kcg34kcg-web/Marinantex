import type {
  PetitionChronologyItem,
  PetitionGenerateInput,
  PetitionGenerateOutput,
  PetitionParty,
} from '@/lib/petition-wizard/types';

interface DeterministicBlocks {
  factsParagraph?: string;
  resultParagraph?: string;
  extraWarnings?: string[];
  extraMissingFields?: string[];
  extraConfidenceNotes?: string[];
}

const CLAIMANT_ROLES = new Set<PetitionParty['role']>(['davaci', 'sikayetci', 'magdur', 'katilan']);
const COUNTERPARTY_ROLES = new Set<PetitionParty['role']>(['davali', 'supheli']);

const ROLE_LABELS: Record<PetitionParty['role'], string> = {
  davaci: 'DAVACI',
  davali: 'DAVALI',
  sikayetci: 'SIKAYETCI',
  supheli: 'SUPHELI',
  magdur: 'MAGDUR',
  katilan: 'KATILAN',
  vekil: 'VEKIL',
  diger: 'DIGER',
};

const SENSITIVE_RULES: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  { label: 'TCKN', pattern: /\b[1-9]\d{10}\b/g, replacement: '[TCKN-MASKELI]' },
  {
    label: 'IBAN',
    pattern: /\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi,
    replacement: '[IBAN-MASKELI]',
  },
  {
    label: 'Telefon',
    pattern: /\b(?:\+?90|0)?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
    replacement: '[TELEFON-MASKELI]',
  },
  {
    label: 'E-posta',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[EPOSTA-MASKELI]',
  },
];

const RISKY_CONTENT_PATTERN =
  /\b(hakaret|tehdit|olumle tehdit|oldururum|yaralarim|siddet|santaj)\b/i;

const DEFAULT_CONFIDENCE_NOTES = [
  'Bu taslak yalnizca kullanicinin sagladigi bilgilere gore uretilmistir.',
  'Metin hukuki danismanlik yerine gecmez; mahkemeye sunmadan once mutlaka gozden gecirilmelidir.',
  'Kanun/madde/emsal numarasi kullanici tarafindan verilmediyse eklenmemistir.',
];

function uniq(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function parseDate(value: string): Date | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const isoDate = new Date(`${raw}T00:00:00`);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }

  const dotParts = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!dotParts) {
    return null;
  }

  const [, dd, mm, yyyy] = dotParts;
  const parsed = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateForPetition(value: string): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return value.trim() || 'belirtilmemis';
  }

  const day = parsed.getDate().toString().padStart(2, '0');
  const month = (parsed.getMonth() + 1).toString().padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}.${month}.${year}`;
}

function cleanList(items: string[]): string[] {
  return uniq(items.map((item) => item.trim()).filter((item) => item.length > 0));
}

function cleanChronology(items: PetitionChronologyItem[]): PetitionChronologyItem[] {
  return items
    .map((item) => ({
      date: item.date?.trim() ?? '',
      event: item.event?.trim() ?? '',
      related_evidence: item.related_evidence?.trim() ?? '',
    }))
    .filter((item) => item.date.length > 0 || item.event.length > 0 || item.related_evidence.length > 0);
}

function cleanParties(parties: PetitionParty[]): PetitionParty[] {
  return parties
    .map((party) => ({
      role: party.role,
      name: party.name.trim(),
      representative: party.representative?.trim() ?? '',
    }))
    .filter((party) => party.name.length > 0);
}

function renderNumberedList(items: string[], fallback: string): string {
  if (items.length === 0) {
    return `1) ${fallback}`;
  }

  return items.map((item, index) => `${index + 1}) ${item}`).join('\n');
}

function detectSensitiveDataLabels(input: PetitionGenerateInput): string[] {
  const fullText = [
    input.court_name,
    input.event_summary,
    input.legal_reasons,
    input.city,
    input.signer_name,
    ...input.requests,
    ...input.evidence,
    ...input.attachments,
    ...input.parties.map((party) => `${party.name} ${party.representative ?? ''}`),
    ...input.chronology.map((item) => `${item.date} ${item.event} ${item.related_evidence ?? ''}`),
  ].join('\n');

  return uniq(
    SENSITIVE_RULES.filter((rule) => {
      rule.pattern.lastIndex = 0;
      return rule.pattern.test(fullText);
    }).map((rule) => rule.label),
  );
}

export function maskSensitiveText(text: string): string {
  return SENSITIVE_RULES.reduce((masked, rule) => masked.replace(rule.pattern, rule.replacement), text);
}

function chronologyWarnings(input: PetitionGenerateInput): string[] {
  const warnings: string[] = [];
  const petitionDate = parseDate(input.date);
  const chronologyDates: Date[] = [];

  for (const item of input.chronology) {
    if (!item.date) {
      continue;
    }

    const parsed = parseDate(item.date);
    if (!parsed) {
      warnings.push(`Kronoloji tarihi anlasilamadi: "${item.date}". Format DD.MM.YYYY olmali.`);
      continue;
    }

    chronologyDates.push(parsed);

    if (petitionDate && parsed > petitionDate) {
      warnings.push(
        `Kronoloji tarihi (${formatDateForPetition(item.date)}) dilekce tarihinden sonra gorunuyor.`,
      );
    }
  }

  for (let index = 1; index < chronologyDates.length; index += 1) {
    if (chronologyDates[index] < chronologyDates[index - 1]) {
      warnings.push('Kronoloji tarihleri artan sirada degil.');
      break;
    }
  }

  return warnings;
}

export function normalizePetitionInput(input: PetitionGenerateInput): PetitionGenerateInput {
  return {
    ...input,
    petition_type: input.petition_type.trim(),
    court_name: input.court_name.trim(),
    event_summary: input.event_summary.trim(),
    legal_reasons: input.legal_reasons.trim(),
    date: input.date.trim(),
    city: input.city.trim(),
    signer_name: input.signer_name.trim(),
    parties: cleanParties(input.parties),
    chronology: cleanChronology(input.chronology),
    requests: cleanList(input.requests),
    evidence: cleanList(input.evidence),
    attachments: cleanList(input.attachments),
  };
}

export function collectMissingFields(input: PetitionGenerateInput): string[] {
  const missing: string[] = [];

  if (!input.petition_type) missing.push('petition_type');
  if (!input.court_name) missing.push('court_name');
  if (!input.event_summary) missing.push('event_summary');
  if (input.event_summary.length > 0 && input.event_summary.length < 100) missing.push('event_summary_detail');
  if (!input.date) missing.push('date');
  if (input.requests.length === 0) missing.push('requests');
  if (input.evidence.length === 0) missing.push('evidence');
  if (input.attachments.length === 0) missing.push('attachments');
  if (input.chronology.length === 0) missing.push('chronology');
  if (input.parties.length === 0) missing.push('parties');

  const hasClaimant = input.parties.some((party) => CLAIMANT_ROLES.has(party.role));
  const hasCounterparty = input.parties.some((party) => COUNTERPARTY_ROLES.has(party.role));

  if (!hasClaimant) missing.push('claimant_party');
  if (!hasCounterparty) missing.push('counter_party');

  return uniq(missing);
}

export function collectGuardrailWarnings(input: PetitionGenerateInput): string[] {
  const warnings: string[] = [];

  if (input.requests.length === 0) {
    warnings.push('Talep listesi bos; sonuc ve istem bolumu zayif kalabilir.');
  }

  if (input.evidence.length === 0) {
    warnings.push('Delil belirtilmemis; ispat gucu dusuk olabilir.');
  }

  if (input.chronology.length === 0) {
    warnings.push('Kronoloji belirtilmemis; tarih-olay-delil akisi onerilir.');
  }

  if (!input.legal_reasons) {
    warnings.push('Hukuki sebepler belirtilmemis; "Ilgili mevzuat hukumleri" ifadesi kullanilacak.');
  }

  const sensitiveLabels = detectSensitiveDataLabels(input);
  if (sensitiveLabels.length > 0) {
    if (input.mask_sensitive_data) {
      warnings.push(
        `Hassas veri tespit edildi (${sensitiveLabels.join(
          ', ',
        )}); cikti metninde maskeleme uygulanacak.`,
      );
    } else {
      warnings.push(
        `Hassas veri tespit edildi (${sensitiveLabels.join(
          ', ',
        )}); mahremiyet icin maskeleme acmaniz onerilir.`,
      );
    }
  }

  if (RISKY_CONTENT_PATTERN.test([input.event_summary, ...input.requests].join('\n'))) {
    warnings.push(
      'Hakaret/tehdit riski olabilecek ifadeler tespit edildi. Metin mahkemeye sunulmadan once uzman kontrolu onerilir.',
    );
  }

  warnings.push(...chronologyWarnings(input));
  return uniq(warnings);
}

function buildPartySection(parties: PetitionParty[]): string {
  if (parties.length === 0) {
    return '- TARAFLAR: belirtilmemis';
  }

  const grouped = new Map<PetitionParty['role'], string[]>();

  for (const party of parties) {
    const line = party.representative
      ? `${party.name} (Vekil: ${party.representative})`
      : party.name;

    const existing = grouped.get(party.role) ?? [];
    grouped.set(party.role, [...existing, line]);
  }

  const orderedRoles = Object.keys(ROLE_LABELS) as PetitionParty['role'][];
  const lines = orderedRoles
    .filter((role) => grouped.has(role))
    .map((role) => `- ${ROLE_LABELS[role]}: ${(grouped.get(role) ?? []).join(' ; ')}`);

  return lines.length > 0 ? lines.join('\n') : '- TARAFLAR: belirtilmemis';
}

function chronologyToLines(chronology: PetitionChronologyItem[], fallbackSummary: string): string[] {
  if (chronology.length === 0) {
    return [fallbackSummary || 'belirtilmemis'];
  }

  return chronology.map((item) => {
    const dateText = item.date ? formatDateForPetition(item.date) : 'tarih belirtilmemis';
    const eventText = item.event || 'olay belirtilmemis';
    const evidenceText = item.related_evidence || 'delil belirtilmemis';
    return `${dateText} - ${eventText} - ${evidenceText}`;
  });
}

export function buildDeterministicPetitionDraft(
  input: PetitionGenerateInput,
  blocks: DeterministicBlocks = {},
): PetitionGenerateOutput {
  const normalized = normalizePetitionInput(input);
  const missing_fields = uniq([...collectMissingFields(normalized), ...(blocks.extraMissingFields ?? [])]);
  const warnings = uniq([...collectGuardrailWarnings(normalized), ...(blocks.extraWarnings ?? [])]);

  const chronologyLines = chronologyToLines(normalized.chronology, normalized.event_summary);
  const legalReasonsText = normalized.legal_reasons || 'Ilgili mevzuat hukumleri.';
  const dateText = formatDateForPetition(normalized.date);
  const cityAndDate = normalized.city ? `${normalized.city}, ${dateText}` : dateText;
  const signer = normalized.signer_name || 'belirtilmemis';

  const explanations = [
    blocks.factsParagraph?.trim() || '',
    renderNumberedList(chronologyLines, normalized.event_summary || 'belirtilmemis'),
  ]
    .filter((value) => value.length > 0)
    .join('\n\n');

  const resultBlock = [
    blocks.resultParagraph?.trim() || '',
    renderNumberedList(normalized.requests, 'belirtilmemis'),
  ]
    .filter((value) => value.length > 0)
    .join('\n\n');

  const draftSections = [
    `${(normalized.court_name || 'belirtilmemis').toLocaleUpperCase('tr-TR')} SAYIN HAKIMLIGINA`,
    'TARAFLAR:',
    buildPartySection(normalized.parties),
    `KONU: ${normalized.petition_type || 'belirtilmemis'}`,
    'ACIKLAMALAR:',
    explanations || 'belirtilmemis',
    'HUKUKI SEBEPLER:',
    legalReasonsText,
    'DELILLER:',
    renderNumberedList(normalized.evidence, 'belirtilmemis'),
    'SONUC VE ISTEM:',
    resultBlock || 'belirtilmemis',
    'EKLER:',
    renderNumberedList(normalized.attachments, 'belirtilmemis'),
    cityAndDate,
    `Imza: ${signer}`,
  ];

  let draft_text = `${draftSections.join('\n\n')}\n`;
  if (normalized.mask_sensitive_data) {
    draft_text = maskSensitiveText(draft_text);
  }

  const confidence_notes = uniq([
    ...DEFAULT_CONFIDENCE_NOTES,
    ...(blocks.extraConfidenceNotes ?? []),
  ]);

  return {
    draft_text,
    warnings,
    missing_fields,
    confidence_notes,
  };
}
