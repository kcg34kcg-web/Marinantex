import type { JSONContent } from "@tiptap/react";

export type LegalBlockId =
  | "subject"
  | "explanations"
  | "legal_reasons"
  | "evidence"
  | "result_and_claim"
  | "attachments";

export interface LegalBlockDefinition {
  id: LegalBlockId;
  label: string;
  description: string;
}

export interface TocHeadingItem {
  level: number;
  text: string;
}

export interface TocBlockRange {
  startIndex: number;
  endIndex: number;
}

const LEGAL_BLOCKS: LegalBlockDefinition[] = [
  {
    id: "subject",
    label: "KONU",
    description: "Dilekcenin kisaca konusu.",
  },
  {
    id: "explanations",
    label: "ACIKLAMALAR",
    description: "Olaylarin ve surecin detayli anlatimi.",
  },
  {
    id: "legal_reasons",
    label: "HUKUKI NEDENLER",
    description: "Uygulanacak mevzuat ve hukuki dayanaklar.",
  },
  {
    id: "evidence",
    label: "DELILLER",
    description: "Ispata esas delillerin listesi.",
  },
  {
    id: "result_and_claim",
    label: "SONUC VE TALEP",
    description: "Mahkemeden beklenen karar ve talepler.",
  },
  {
    id: "attachments",
    label: "EKLER",
    description: "Dilekceye eklenen belgelerin listesi.",
  },
];

const TOC_TITLE_TEXT = "ICINDEKILER:";
const TOC_GUIDANCE_TEXT = "Icindekiler olusturmak icin belgeye H1/H2/H3 basliklari ekleyin.";

function blockTitleParagraph(title: string): JSONContent {
  return {
    type: "paragraph",
    content: [
      {
        type: "text",
        marks: [{ type: "bold" }],
        text: `${title}:`,
      },
    ],
  };
}

function bulletList(items: string[]): JSONContent {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: item }],
        },
      ],
    })),
  };
}

function orderedList(items: string[]): JSONContent {
  return {
    type: "orderedList",
    content: items.map((item) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: item }],
        },
      ],
    })),
  };
}

function trailingSpaceParagraph(): JSONContent {
  return {
    type: "paragraph",
  };
}

export function listLegalBlockDefinitions(): LegalBlockDefinition[] {
  return LEGAL_BLOCKS;
}

function normalizeHeadingLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(6, Math.max(1, Math.floor(level)));
}

function buildHeadingNumbers(items: TocHeadingItem[]): Array<{ level: number; text: string; number: string }> {
  const counters = [0, 0, 0, 0, 0, 0];
  return items.map((item) => {
    const level = normalizeHeadingLevel(item.level);
    const index = level - 1;
    counters[index] = (counters[index] ?? 0) + 1;
    for (let i = index + 1; i < counters.length; i += 1) {
      counters[i] = 0;
    }
    const number = counters.slice(0, level).filter((value) => value > 0).join(".");
    return { level, text: item.text.trim(), number };
  });
}

export function buildTableOfContentsContent(items: TocHeadingItem[]): JSONContent[] {
  const normalized = items
    .map((item) => ({ level: item.level, text: item.text.trim() }))
    .filter((item) => item.text.length > 0);

  if (!normalized.length) {
    return [
      blockTitleParagraph("ICINDEKILER"),
      {
        type: "paragraph",
        content: [{ type: "text", text: TOC_GUIDANCE_TEXT }],
      },
      trailingSpaceParagraph(),
    ];
  }

  const numbered = buildHeadingNumbers(normalized);

  return [
    blockTitleParagraph("ICINDEKILER"),
    ...numbered.map((item) => ({
      type: "paragraph",
      attrs: item.level > 1 ? { marginLeft: `${(item.level - 1) * 16}px` } : undefined,
      content: [{ type: "text", text: `${item.number}. ${item.text}` }],
    })),
    trailingSpaceParagraph(),
  ];
}

function extractPlainText(node: JSONContent | null | undefined): string {
  if (!node || typeof node !== "object") return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((item) => extractPlainText(item as JSONContent)).join("");
}

function isTocNumberedLine(text: string): boolean {
  return /^\d+(?:\.\d+)*\.\s+\S/u.test(text);
}

export function findTableOfContentsRange(nodes: JSONContent[]): TocBlockRange | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const titleText = extractPlainText(nodes[i]).trim();
    if (titleText !== TOC_TITLE_TEXT) continue;

    let endIndex = i;
    let hasKnownBody = false;

    for (let j = i + 1; j < nodes.length; j += 1) {
      const lineText = extractPlainText(nodes[j]).trim();
      if (!lineText) {
        if (hasKnownBody) {
          endIndex = j;
        }
        break;
      }

      if (lineText === TOC_GUIDANCE_TEXT || isTocNumberedLine(lineText)) {
        hasKnownBody = true;
        endIndex = j;
        continue;
      }
      break;
    }

    if (hasKnownBody) {
      return { startIndex: i, endIndex };
    }
  }

  return null;
}

export function buildLegalBlockContent(id: LegalBlockId): JSONContent[] {
  if (id === "subject") {
    return [
      blockTitleParagraph("KONU"),
      {
        type: "paragraph",
        content: [{ type: "text", text: "Dava konusu kisaca aciklanir." }],
      },
      trailingSpaceParagraph(),
    ];
  }

  if (id === "explanations") {
    return [
      blockTitleParagraph("ACIKLAMALAR"),
      orderedList([
        "Olayin kronolojik ozeti.",
        "Taraflarin iddia ve savunmalari.",
      ]),
      trailingSpaceParagraph(),
    ];
  }

  if (id === "legal_reasons") {
    return [
      blockTitleParagraph("HUKUKI NEDENLER"),
      bulletList([
        "Ilgili kanun maddeleri.",
        "Ilgili ictihat ve diger hukuki dayanaklar.",
      ]),
      trailingSpaceParagraph(),
    ];
  }

  if (id === "evidence") {
    return [
      blockTitleParagraph("DELILLER"),
      bulletList([
        "Yazili belgeler",
        "Bilirkişi incelemesi",
        "Tanık beyanlari",
      ]),
      trailingSpaceParagraph(),
    ];
  }

  if (id === "attachments") {
    return [
      blockTitleParagraph("EKLER"),
      orderedList([
        "Ek-1: Belge adi",
        "Ek-2: Belge adi",
      ]),
      trailingSpaceParagraph(),
    ];
  }

  return [
    blockTitleParagraph("SONUC VE TALEP"),
    orderedList([
      "Davanin kabulune karar verilmesi.",
      "Yargilama giderleri ve vekalet ucretinin karsi tarafa yukletilmesi.",
    ]),
    trailingSpaceParagraph(),
  ];
}
