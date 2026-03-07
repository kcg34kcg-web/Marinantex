import type { JSONContent } from "@tiptap/react";
import { readStoredZipEntryMap } from "./readZip";
import type {
  DocAlignment,
  DocModel,
  DocWarning,
  InlineNode,
  InlineStyle,
  ParagraphNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "./types";
import { EMPTY_PARAGRAPH_PLACEHOLDER } from "./xmlBuilder";

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  textContent: string;
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_][a-zA-Z0-9_-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null = attrRegex.exec(raw);
  while (match) {
    const key = match[1] ?? "";
    const value = match[2] ?? "";
    attrs[key] = decodeXmlEntities(value);
    match = attrRegex.exec(raw);
  }
  return attrs;
}

function parseXmlTree(xml: string): XmlNode {
  const root: XmlNode = {
    name: "__root__",
    attrs: {},
    children: [],
    textContent: "",
  };
  const stack: XmlNode[] = [root];
  const tokenRegex = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[a-zA-Z0-9:_-]+(?:\s+[^<>]*?)?\s*\/?>|[^<]+/g;
  let tokenMatch: RegExpExecArray | null = tokenRegex.exec(xml);

  while (tokenMatch) {
    const token = tokenMatch[0] ?? "";
    const current = stack[stack.length - 1] ?? root;

    if (token.startsWith("<?") || token.startsWith("<!--")) {
      tokenMatch = tokenRegex.exec(xml);
      continue;
    }

    if (token.startsWith("</")) {
      const closeMatch = /^<\/\s*([a-zA-Z0-9:_-]+)\s*>$/.exec(token);
      if (closeMatch) {
        const closeName = closeMatch[1] ?? "";
        while (stack.length > 1) {
          const node = stack.pop();
          if (node?.name === closeName) {
            break;
          }
        }
      }
      tokenMatch = tokenRegex.exec(xml);
      continue;
    }

    if (token.startsWith("<")) {
      const selfClosing = token.endsWith("/>");
      const openMatch = /^<\s*([a-zA-Z0-9:_-]+)([\s\S]*?)\/?>$/.exec(token);
      if (openMatch) {
        const name = openMatch[1] ?? "";
        const rawAttrs = openMatch[2] ?? "";
        const node: XmlNode = {
          name,
          attrs: parseAttrs(rawAttrs),
          children: [],
          textContent: "",
        };
        current.children.push(node);
        if (!selfClosing) {
          stack.push(node);
        }
      }
      tokenMatch = tokenRegex.exec(xml);
      continue;
    }

    current.textContent += token;
    tokenMatch = tokenRegex.exec(xml);
  }

  return root;
}

function firstChild(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((child) => child.name === name) ?? null;
}

function childrenByName(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

function parseAlignment(raw?: string): DocAlignment {
  if (raw === "center" || raw === "right" || raw === "justify") {
    return raw;
  }
  return "left";
}

function parsePositiveInt(raw?: string, fallback = 0): number {
  if (!raw || !/^\d+$/.test(raw)) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseInlineStyle(attrs: Record<string, string>): InlineStyle {
  const style: InlineStyle = {};
  if (attrs.fontFamily) {
    style.fontFamily = attrs.fontFamily;
  }
  if (attrs.fontSize && /^\d+$/.test(attrs.fontSize)) {
    style.fontSize = Number.parseInt(attrs.fontSize, 10);
  }
  if (attrs.bold === "1") {
    style.bold = true;
  }
  if (attrs.italic === "1") {
    style.italic = true;
  }
  if (attrs.underline === "1") {
    style.underline = true;
  }
  return style;
}

function sliceByOffset(
  buffer: string,
  attrs: Record<string, string>,
  warnings: string[],
  path: string,
): string {
  const startOffset = parsePositiveInt(attrs.startOffset, -1);
  const length = parsePositiveInt(attrs.length, -1);
  if (startOffset < 0 || length <= 0) {
    warnings.push(`${path}: startOffset/length gecersiz, inline atlandi.`);
    return "";
  }
  if (startOffset + length > buffer.length) {
    warnings.push(`${path}: referans contentBuffer sinirini asiyor, inline kirpildi.`);
    return buffer.slice(Math.max(0, startOffset), Math.min(buffer.length, startOffset + length));
  }
  return buffer.slice(startOffset, startOffset + length);
}

function parseParagraphNode(
  paragraphNode: XmlNode,
  buffer: string,
  warnings: string[],
  path: string,
): ParagraphNode {
  const inlines: InlineNode[] = [];
  let preserveEmpty = false;

  paragraphNode.children.forEach((inlineNode, index) => {
    const inlinePath = `${path}/inline/${index}`;

    if (inlineNode.name === "lineBreak") {
      inlines.push({ kind: "lineBreak" });
      return;
    }

    if (inlineNode.name === "tab") {
      const value = sliceByOffset(buffer, inlineNode.attrs, warnings, inlinePath);
      if (value !== "\t") {
        warnings.push(`${inlinePath}: tab referansi '\\t' degeri gostermuyor.`);
      }
      inlines.push({
        kind: "tab",
        style: parseInlineStyle(inlineNode.attrs),
      });
      return;
    }

    if (inlineNode.name === "text") {
      const value = sliceByOffset(buffer, inlineNode.attrs, warnings, inlinePath);
      if (inlineNode.attrs.placeholder === "1" && value === EMPTY_PARAGRAPH_PLACEHOLDER) {
        preserveEmpty = true;
        return;
      }
      if (!value) {
        return;
      }
      inlines.push({
        kind: "text",
        text: value,
        style: parseInlineStyle(inlineNode.attrs),
      });
      return;
    }

    warnings.push(`${inlinePath}: desteklenmeyen inline '${inlineNode.name}' atlandi.`);
  });

  return {
    kind: "paragraph",
    alignment: parseAlignment(paragraphNode.attrs.alignment),
    inlines,
    preserveEmpty: preserveEmpty || inlines.length === 0,
    sourceNodeType: paragraphNode.attrs.source || "paragraph",
  };
}

function parseCellNode(
  cellNode: XmlNode,
  buffer: string,
  warnings: string[],
  path: string,
): TableCellNode {
  const paragraphs = childrenByName(cellNode, "paragraph").map((paragraphNode, paragraphIndex) =>
    parseParagraphNode(paragraphNode, buffer, warnings, `${path}/paragraph/${paragraphIndex}`),
  );

  return {
    kind: "tableCell",
    colSpan: Math.max(1, parsePositiveInt(cellNode.attrs.colSpan, 1)),
    rowSpan: Math.max(1, parsePositiveInt(cellNode.attrs.rowSpan, 1)),
    paragraphs: paragraphs.length
      ? paragraphs
      : [
          {
            kind: "paragraph",
            alignment: "left",
            inlines: [],
            preserveEmpty: true,
            sourceNodeType: "tableCell",
          },
        ],
  };
}

function parseTableNode(
  tableNode: XmlNode,
  buffer: string,
  warnings: string[],
  path: string,
): TableNode {
  const rows: TableRowNode[] = childrenByName(tableNode, "row").map((rowNode, rowIndex) => {
    const cells = childrenByName(rowNode, "cell").map((cellNode, cellIndex) =>
      parseCellNode(cellNode, buffer, warnings, `${path}/row/${rowIndex}/cell/${cellIndex}`),
    );
    return {
      kind: "tableRow",
      cells,
    };
  });

  return {
    kind: "table",
    border: "single",
    rows,
  };
}

function warningCodeFromString(raw: string): DocWarning["code"] {
  const allowed: DocWarning["code"][] = [
    "UNSUPPORTED_BLOCK",
    "UNSUPPORTED_INLINE",
    "UNSUPPORTED_TABLE_NESTING",
    "TABLE_SPAN_DEGRADED",
    "FONT_FALLBACK",
    "EMPTY_DOCUMENT",
  ];
  return allowed.includes(raw as DocWarning["code"])
    ? (raw as DocWarning["code"])
    : "UNSUPPORTED_BLOCK";
}

function toDocModelFromUdfXml(contentXml: string): {
  docModel: DocModel;
  parserWarnings: string[];
} {
  const parserWarnings: string[] = [];
  const tree = parseXmlTree(contentXml);
  const udfContent = firstChild(tree, "udfContent");

  if (!udfContent) {
    return {
      docModel: {
        schemaVersion: 1,
        blocks: [
          {
            kind: "paragraph",
            alignment: "left",
            inlines: [],
            preserveEmpty: true,
            sourceNodeType: "udf-import-fallback",
          },
        ],
        warnings: [
          {
            code: "EMPTY_DOCUMENT",
            message: "udfContent bulunamadi, bos belge olusturuldu.",
            path: "udfContent",
          },
        ],
      },
      parserWarnings: ["udfContent root tag bulunamadi."],
    };
  }

  const contentBufferNode = firstChild(udfContent, "contentBuffer");
  const bodyNode = firstChild(udfContent, "body");
  const warningsNode = firstChild(udfContent, "warnings");
  const buffer = decodeXmlEntities(contentBufferNode?.textContent ?? "");
  const blocks: Array<ParagraphNode | TableNode> = [];
  (bodyNode?.children ?? []).forEach((blockNode, index) => {
    const path = `body/block/${index}`;
    if (blockNode.name === "paragraph") {
      blocks.push(parseParagraphNode(blockNode, buffer, parserWarnings, path));
      return;
    }
    if (blockNode.name === "table") {
      blocks.push(parseTableNode(blockNode, buffer, parserWarnings, path));
      return;
    }
    parserWarnings.push(`${path}: desteklenmeyen block '${blockNode.name}' atlandi.`);
  });

  const warningNodes = warningsNode ? childrenByName(warningsNode, "warning") : [];
  const warnings: DocWarning[] = warningNodes.map((warningNode) => ({
    code: warningCodeFromString(warningNode.attrs.code ?? ""),
    path: warningNode.attrs.path ?? "warnings",
    message: decodeXmlEntities(warningNode.textContent || ""),
  }));

  const normalizedBlocks = blocks.length
    ? blocks
    : [
        {
          kind: "paragraph",
          alignment: "left",
          inlines: [],
          preserveEmpty: true,
          sourceNodeType: "udf-import-fallback",
        } satisfies ParagraphNode,
      ];

  return {
    docModel: {
      schemaVersion: 1,
      blocks: normalizedBlocks,
      warnings,
    },
    parserWarnings,
  };
}

function marksFromStyle(style: InlineStyle): Array<{ type: string; attrs?: Record<string, unknown> }> {
  const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
  const textStyleAttrs: Record<string, unknown> = {};

  if (style.fontFamily) {
    textStyleAttrs.fontFamily = style.fontFamily;
  }
  if (typeof style.fontSize === "number" && Number.isFinite(style.fontSize)) {
    textStyleAttrs.fontSize = `${Math.round(style.fontSize)}px`;
  }
  if (Object.keys(textStyleAttrs).length) {
    marks.push({
      type: "textStyle",
      attrs: textStyleAttrs,
    });
  }

  if (style.bold) {
    marks.push({ type: "bold" });
  }
  if (style.italic) {
    marks.push({ type: "italic" });
  }
  if (style.underline) {
    marks.push({ type: "underline" });
  }

  return marks;
}

function paragraphToTiptapNode(paragraph: ParagraphNode): JSONContent {
  const content: JSONContent[] = [];

  paragraph.inlines.forEach((inline) => {
    if (inline.kind === "lineBreak") {
      content.push({ type: "hardBreak" });
      return;
    }
    if (inline.kind === "tab") {
      const marks = marksFromStyle(inline.style);
      content.push({
        type: "text",
        text: "\t",
        ...(marks.length ? { marks } : {}),
      });
      return;
    }
    const marks = marksFromStyle(inline.style);
    content.push({
      type: "text",
      text: inline.text,
      ...(marks.length ? { marks } : {}),
    });
  });

  const attrs =
    paragraph.alignment !== "left"
      ? {
          textAlign: paragraph.alignment,
        }
      : undefined;

  return {
    type: "paragraph",
    ...(attrs ? { attrs } : {}),
    ...(content.length || !paragraph.preserveEmpty ? { content } : {}),
  };
}

function tableToTiptapNode(table: TableNode): JSONContent {
  return {
    type: "table",
    content: table.rows.map((row) => ({
      type: "tableRow",
      content: row.cells.map((cell) => ({
        type: "tableCell",
        ...(cell.colSpan > 1 || cell.rowSpan > 1
          ? {
              attrs: {
                colspan: cell.colSpan,
                rowspan: cell.rowSpan,
              },
            }
          : {}),
        content: cell.paragraphs.map((paragraph) => paragraphToTiptapNode(paragraph)),
      })),
    })),
  };
}

function docModelToEditorJson(docModel: DocModel): JSONContent {
  const content: JSONContent[] = docModel.blocks.map((block) =>
    block.kind === "paragraph" ? paragraphToTiptapNode(block) : tableToTiptapNode(block),
  );

  return {
    type: "doc",
    content,
  };
}

export interface ImportedUdfDocument {
  docModel: DocModel;
  editorJson: JSONContent;
  parserWarnings: string[];
  sourceEntry: "content.xml" | "document.xml";
}

export function importUdfArchive(archive: Uint8Array): ImportedUdfDocument {
  const entries = readStoredZipEntryMap(archive);
  const sourceEntry = entries["content.xml"] ? "content.xml" : "document.xml";
  const sourceBuffer = entries[sourceEntry];
  if (!sourceBuffer) {
    throw new Error("UDF arsivinde content.xml veya document.xml bulunamadi.");
  }

  const contentXml = new TextDecoder().decode(sourceBuffer);
  const parsed = toDocModelFromUdfXml(contentXml);

  return {
    docModel: parsed.docModel,
    editorJson: docModelToEditorJson(parsed.docModel),
    parserWarnings: parsed.parserWarnings,
    sourceEntry,
  };
}

export async function importUdfFile(file: File): Promise<ImportedUdfDocument> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  return importUdfArchive(buffer);
}
