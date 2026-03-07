import type { DocModel, InlineStyle, ParagraphNode, TableNode } from "./types";

export const EMPTY_PARAGRAPH_PLACEHOLDER = "\u200B";

interface BufferRef {
  startOffset: number;
  length: number;
}

interface ContentBuffer {
  value: string;
  append: (text: string) => BufferRef;
}

function createContentBuffer(): ContentBuffer {
  let value = "";
  return {
    get value() {
      return value;
    },
    append(text: string) {
      const startOffset = value.length;
      value += text;
      return {
        startOffset,
        length: text.length,
      };
    },
  };
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatStyle(style: InlineStyle): string {
  const attrs: string[] = [];
  if (style.fontFamily) {
    attrs.push(`fontFamily="${esc(style.fontFamily)}"`);
  }
  if (typeof style.fontSize === "number" && Number.isFinite(style.fontSize)) {
    attrs.push(`fontSize="${Math.round(style.fontSize)}"`);
  }
  if (style.bold) {
    attrs.push('bold="1"');
  }
  if (style.italic) {
    attrs.push('italic="1"');
  }
  if (style.underline) {
    attrs.push('underline="1"');
  }

  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

function serializeParagraph(
  paragraph: ParagraphNode,
  buffer: ContentBuffer,
): string {
  const lines: string[] = [];

  if (!paragraph.inlines.length || paragraph.preserveEmpty) {
    const ref = buffer.append(EMPTY_PARAGRAPH_PLACEHOLDER);
    lines.push(
      `<text startOffset="${ref.startOffset}" length="${ref.length}" placeholder="1" />`,
    );
  } else {
    for (const inline of paragraph.inlines) {
      if (inline.kind === "lineBreak") {
        const ref = buffer.append("\n");
        lines.push(
          `<lineBreak startOffset="${ref.startOffset}" length="${ref.length}" />`,
        );
        continue;
      }

      if (inline.kind === "tab") {
        const ref = buffer.append("\t");
        lines.push(
          `<tab startOffset="${ref.startOffset}" length="${ref.length}"${formatStyle(inline.style)} />`,
        );
        continue;
      }

      const ref = buffer.append(inline.text);
      lines.push(
        `<text startOffset="${ref.startOffset}" length="${ref.length}"${formatStyle(inline.style)} />`,
      );
    }
  }

  return [
    `<paragraph alignment="${paragraph.alignment}" source="${esc(paragraph.sourceNodeType)}">`,
    ...lines.map((line) => `  ${line}`),
    "</paragraph>",
  ].join("\n");
}

function serializeTable(table: TableNode, buffer: ContentBuffer): string {
  const lines: string[] = [
    `<table border="${table.border}">`,
  ];

  table.rows.forEach((row, rowIndex) => {
    lines.push(`  <row index="${rowIndex}">`);
    row.cells.forEach((cell, cellIndex) => {
      lines.push(
        `    <cell index="${cellIndex}" colSpan="${cell.colSpan}" rowSpan="${cell.rowSpan}" border="single">`,
      );
      cell.paragraphs.forEach((paragraph) => {
        const renderedParagraph = serializeParagraph(paragraph, buffer)
          .split("\n")
          .map((line) => `      ${line}`)
          .join("\n");
        lines.push(renderedParagraph);
      });
      lines.push("    </cell>");
    });
    lines.push("  </row>");
  });

  lines.push("</table>");
  return lines.join("\n");
}

export interface UdfXmlBuildResult {
  contentXml: string;
  contentBuffer: string;
}

export function buildUdfContentXml(docModel: DocModel): UdfXmlBuildResult {
  const buffer = createContentBuffer();
  const bodyLines: string[] = [];

  docModel.blocks.forEach((block) => {
    if (block.kind === "paragraph") {
      bodyLines.push(serializeParagraph(block, buffer));
      return;
    }
    bodyLines.push(serializeTable(block, buffer));
  });

  const warningsXml = docModel.warnings.length
    ? [
      "<warnings>",
      ...docModel.warnings.map((item) => `  <warning code="${item.code}" path="${esc(item.path)}">${esc(item.message)}</warning>`),
      "</warnings>",
    ].join("\n")
    : "<warnings />";

  const contentXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<udfContent schemaVersion="1">',
    `<contentBuffer>${esc(buffer.value)}</contentBuffer>`,
    "<body>",
    ...bodyLines.map((line) => `  ${line}`),
    "</body>",
    warningsXml,
    "</udfContent>",
  ].join("\n");

  return {
    contentXml,
    contentBuffer: buffer.value,
  };
}
