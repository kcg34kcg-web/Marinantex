export type LegalStylePresetId =
  | "petition_standard"
  | "contract_compact"
  | "defense_readable";

export interface LegalStylePreset {
  id: LegalStylePresetId;
  label: string;
  description: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  paragraphSpacingPx: number;
  paragraphIndentPx: number;
  textAlign: "left" | "center" | "right" | "justify";
}

const LEGAL_STYLE_PRESETS: LegalStylePreset[] = [
  {
    id: "petition_standard",
    label: "Dilekce Standart",
    description: "Mahkeme dilekceleri icin okunabilir ve resmi varsayilan.",
    fontFamily: "'Times New Roman',serif",
    fontSize: "12px",
    lineHeight: "1.5",
    paragraphSpacingPx: 6,
    paragraphIndentPx: 0,
    textAlign: "justify",
  },
  {
    id: "contract_compact",
    label: "Sozlesme Kompakt",
    description: "Madde bazli sozlesmeler icin daha sik satir duzeni.",
    fontFamily: "Calibri,'Segoe UI',sans-serif",
    fontSize: "11px",
    lineHeight: "1.35",
    paragraphSpacingPx: 4,
    paragraphIndentPx: 0,
    textAlign: "justify",
  },
  {
    id: "defense_readable",
    label: "Savunma Okunakli",
    description: "Uzun savunma metinlerinde rahat okuma icin.",
    fontFamily: "Georgia,serif",
    fontSize: "12px",
    lineHeight: "1.6",
    paragraphSpacingPx: 8,
    paragraphIndentPx: 0,
    textAlign: "justify",
  },
];

export function listLegalStylePresets(): LegalStylePreset[] {
  return LEGAL_STYLE_PRESETS;
}

export function getLegalStylePresetById(id: LegalStylePresetId): LegalStylePreset | null {
  return LEGAL_STYLE_PRESETS.find((item) => item.id === id) ?? null;
}
