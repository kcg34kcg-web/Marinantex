import type { JSONContent } from "@tiptap/react";
import {
  defaultFontFamily,
  normalizeFontFamily,
} from "./font-normalization";
import type {
  BlockNode,
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

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function toAlignment(raw: unknown): DocAlignment {
  if (raw === "center" || raw === "right" || raw === "justify") {
    return raw;
  }
  return "left";
}

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim().toLocaleLowerCase("tr");
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.endsWith("px")) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function warning(
  warnings: DocWarning[],
  code: DocWarning["code"],
  message: string,
  path: string,
) {
  warnings.push({ code, message, path });
}

function toSafeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function collectText(node: JSONContent): string {
  if (node.type === "text") {
    return toSafeText(node.text);
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  if (node.type === "lawMention") {
    const attrs = (node.attrs ?? {}) as { label?: unknown; text?: unknown };
    const label = toSafeText(attrs.label).trim();
    const text = toSafeText(attrs.text).trim();
    if (text) return text;
    if (label) return `@${label}`;
    return "@Madde";
  }

  if (node.type === "dynamicField") {
    const attrs = (node.attrs ?? {}) as { label?: unknown; value?: unknown };
    const label = toSafeText(attrs.label).trim() || "Field";
    const value = toSafeText(attrs.value).trim();
    return value ? `{{${label}: ${value}}}` : `{{${label}}}`;
  }

  if (node.type === "footnote") {
    const attrs = (node.attrs ?? {}) as { content?: unknown };
    const content = toSafeText(attrs.content).trim();
    return content ? `[Dipnot: ${content}]` : "[Dipnot]";
  }

  return asArray(node.content).map((child) => collectText(child)).join("");
}

function splitTextWithControls(text: string, style: InlineStyle): InlineNode[] {
  const next: InlineNode[] = [];
  if (!text) {
    return next;
  }

  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    next.push({
      kind: "text",
      text: buffer,
      style,
    });
    buffer = "";
  };

  for (const char of text) {
    if (char === "\t") {
      flush();
      next.push({
        kind: "tab",
        style,
      });
      continue;
    }

    if (char === "\n") {
      flush();
      next.push({
        kind: "lineBreak",
      });
      continue;
    }

    buffer += char;
  }

  flush();
  return next;
}

function extractStyle(
  marks: JSONContent["marks"],
  warnings: DocWarning[],
  path: string,
): InlineStyle {
  const style: InlineStyle = {};

  for (const mark of asArray(marks)) {
    if (mark.type === "bold") {
      style.bold = true;
      continue;
    }

    if (mark.type === "italic") {
      style.italic = true;
      continue;
    }

    if (mark.type === "underline") {
      style.underline = true;
      continue;
    }

    if (mark.type === "textStyle") {
      const attrs = (mark.attrs ?? {}) as {
        fontFamily?: unknown;
        fontSize?: unknown;
      };

      const family = toSafeText(attrs.fontFamily);
      if (family.trim()) {
        const normalized = normalizeFontFamily(family);
        style.fontFamily = normalized.normalized;
        if (normalized.changed) {
          warning(
            warnings,
            "FONT_FALLBACK",
            `Font fallback uygulandi: ${family} -> ${normalized.normalized}`,
            path,
          );
        }
      }

      const fontSize = toNumber(attrs.fontSize);
      if (fontSize) {
        style.fontSize = fontSize;
      }
    }
  }

  if (!style.fontFamily) {
    style.fontFamily = defaultFontFamily();
  }

  return style;
}

function mapInlineChildren(
  content: JSONContent[] | undefined,
  warnings: DocWarning[],
  path: string,
): InlineNode[] {
  const next: InlineNode[] = [];

  asArray(content).forEach((node, index) => {
    const nodePath = `${path}/content/${index}`;

    if (node.type === "text") {
      const style = extractStyle(node.marks, warnings, nodePath);
      next.push(...splitTextWithControls(toSafeText(node.text), style));
      return;
    }

    if (node.type === "hardBreak") {
      next.push({ kind: "lineBreak" });
      return;
    }

    if (
      node.type === "lawMention" ||
      node.type === "dynamicField" ||
      node.type === "footnote"
    ) {
      const style = {
        fontFamily: defaultFontFamily(),
      } satisfies InlineStyle;
      next.push(...splitTextWithControls(collectText(node), style));
      return;
    }

    if (node.type && asArray(node.content).length > 0) {
      const nestedText = collectText(node);
      if (nestedText) {
        warning(
          warnings,
          "UNSUPPORTED_INLINE",
          `Inline node degrade edildi: ${node.type}`,
          nodePath,
        );
        const style = {
          fontFamily: defaultFontFamily(),
        } satisfies InlineStyle;
        next.push(...splitTextWithControls(nestedText, style));
      }
      return;
    }

    warning(
      warnings,
      "UNSUPPORTED_INLINE",
      `Inline node desteklenmiyor: ${node.type ?? "unknown"}`,
      nodePath,
    );
  });

  return next;
}

function mapParagraphNode(
  node: JSONContent,
  warnings: DocWarning[],
  path: string,
): ParagraphNode {
  const attrs = (node.attrs ?? {}) as { textAlign?: unknown };
  const inlines = mapInlineChildren(node.content, warnings, path);

  return {
    kind: "paragraph",
    alignment: toAlignment(attrs.textAlign),
    inlines,
    preserveEmpty: inlines.length === 0,
    sourceNodeType: node.type ?? "paragraph",
  };
}

function paragraphFromText(text: string, sourceNodeType: string): ParagraphNode {
  const style = {
    fontFamily: defaultFontFamily(),
  } satisfies InlineStyle;
  const inlines = splitTextWithControls(text, style);
  return {
    kind: "paragraph",
    alignment: "left",
    inlines,
    preserveEmpty: inlines.length === 0,
    sourceNodeType,
  };
}

function mapCellParagraphs(
  content: JSONContent[] | undefined,
  warnings: DocWarning[],
  path: string,
): ParagraphNode[] {
  const paragraphs: ParagraphNode[] = [];

  asArray(content).forEach((child, index) => {
    const childPath = `${path}/content/${index}`;

    if (
      child.type === "paragraph" ||
      child.type === "heading" ||
      child.type === "codeBlock"
    ) {
      paragraphs.push(mapParagraphNode(child, warnings, childPath));
      return;
    }

    if (child.type === "table") {
      warning(
        warnings,
        "UNSUPPORTED_TABLE_NESTING",
        "Ic ice tablo UDF icin sade metne indirildi.",
        childPath,
      );
      const text = collectText(child).trim();
      paragraphs.push(paragraphFromText(text || "[Ic ice tablo]", "nested-table"));
      return;
    }

    if (child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList") {
      const listParagraphs = mapListNode(child, warnings, childPath);
      paragraphs.push(...listParagraphs);
      return;
    }

    const text = collectText(child).trim();
    if (text) {
      warning(
        warnings,
        "UNSUPPORTED_BLOCK",
        `Table cell block degrade edildi: ${child.type ?? "unknown"}`,
        childPath,
      );
      paragraphs.push(paragraphFromText(text, child.type ?? "unknown"));
    }
  });

  if (!paragraphs.length) {
    paragraphs.push({
      kind: "paragraph",
      alignment: "left",
      inlines: [],
      preserveEmpty: true,
      sourceNodeType: "tableCell",
    });
  }

  return paragraphs;
}

function mapTableNode(
  node: JSONContent,
  warnings: DocWarning[],
  path: string,
): TableNode {
  const rows: TableRowNode[] = [];

  asArray(node.content).forEach((rowNode, rowIndex) => {
    const rowPath = `${path}/content/${rowIndex}`;
    if (rowNode.type !== "tableRow") {
      warning(
        warnings,
        "UNSUPPORTED_BLOCK",
        `Table satiri disi node atlandi: ${rowNode.type ?? "unknown"}`,
        rowPath,
      );
      return;
    }

    const cells: TableCellNode[] = [];
    asArray(rowNode.content).forEach((cellNode, cellIndex) => {
      const cellPath = `${rowPath}/content/${cellIndex}`;
      if (cellNode.type !== "tableCell" && cellNode.type !== "tableHeader") {
        warning(
          warnings,
          "UNSUPPORTED_BLOCK",
          `Table hucre disi node atlandi: ${cellNode.type ?? "unknown"}`,
          cellPath,
        );
        return;
      }

      const attrs = (cellNode.attrs ?? {}) as {
        colspan?: unknown;
        rowspan?: unknown;
      };

      const colSpan = Math.max(1, Math.round(toNumber(attrs.colspan) ?? 1));
      const rowSpan = Math.max(1, Math.round(toNumber(attrs.rowspan) ?? 1));

      if (colSpan > 1 || rowSpan > 1) {
        warning(
          warnings,
          "TABLE_SPAN_DEGRADED",
          `Hucre birlestirme degrade edildi (colSpan=${colSpan}, rowSpan=${rowSpan}).`,
          cellPath,
        );
      }

      cells.push({
        kind: "tableCell",
        colSpan,
        rowSpan,
        paragraphs: mapCellParagraphs(cellNode.content, warnings, cellPath),
      });
    });

    rows.push({
      kind: "tableRow",
      cells,
    });
  });

  return {
    kind: "table",
    border: "single",
    rows,
  };
}

function mapListNode(
  node: JSONContent,
  warnings: DocWarning[],
  path: string,
): ParagraphNode[] {
  const ordered = node.type === "orderedList";
  const paragraphs: ParagraphNode[] = [];

  asArray(node.content).forEach((itemNode, itemIndex) => {
    const itemPath = `${path}/content/${itemIndex}`;
    if (itemNode.type !== "listItem" && itemNode.type !== "taskItem") {
      warning(
        warnings,
        "UNSUPPORTED_BLOCK",
        `Liste elemani disi node degrade edildi: ${itemNode.type ?? "unknown"}`,
        itemPath,
      );
      const text = collectText(itemNode).trim();
      if (text) {
        paragraphs.push(paragraphFromText(text, itemNode.type ?? "unknown"));
      }
      return;
    }

    const prefix = ordered ? `${itemIndex + 1}. ` : "- ";
    const itemBlocks = mapNodesToBlocks(itemNode.content, warnings, itemPath);

    if (!itemBlocks.length) {
      paragraphs.push(paragraphFromText(prefix, "listItem"));
      return;
    }

    itemBlocks.forEach((block, blockIndex) => {
      if (block.kind === "table") {
        const tableText = tableToPlainText(block);
        paragraphs.push(paragraphFromText(`${prefix}${tableText}`, "list-table"));
        warning(
          warnings,
          "UNSUPPORTED_BLOCK",
          "Liste icindeki tablo sade metne indirildi.",
          `${itemPath}/block/${blockIndex}`,
        );
        return;
      }

      if (blockIndex === 0) {
        const prefixed = [...splitTextWithControls(prefix, { fontFamily: defaultFontFamily() }), ...block.inlines];
        paragraphs.push({
          ...block,
          inlines: prefixed,
          preserveEmpty: prefixed.length === 0,
        });
      } else {
        paragraphs.push(block);
      }
    });
  });

  return paragraphs;
}

function mapNodeToBlocks(
  node: JSONContent,
  warnings: DocWarning[],
  path: string,
): BlockNode[] {
  if (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "codeBlock"
  ) {
    return [mapParagraphNode(node, warnings, path)];
  }

  if (node.type === "table") {
    return [mapTableNode(node, warnings, path)];
  }

  if (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") {
    return mapListNode(node, warnings, path);
  }

  if (node.type === "blockquote") {
    return mapNodesToBlocks(node.content, warnings, path);
  }

  if (node.type === "horizontalRule") {
    return [paragraphFromText("---", "horizontalRule")];
  }

  if (node.type === "image") {
    warning(warnings, "UNSUPPORTED_BLOCK", "Gorsel UDF export icin metne indirildi.", path);
    return [paragraphFromText("[Gorsel]", "image")];
  }

  if (node.type === "text") {
    return [paragraphFromText(toSafeText(node.text), "text")];
  }

  const fallback = collectText(node).trim();
  if (fallback) {
    warning(
      warnings,
      "UNSUPPORTED_BLOCK",
      `Desteklenmeyen block degrade edildi: ${node.type ?? "unknown"}`,
      path,
    );
    return [paragraphFromText(fallback, node.type ?? "unknown")];
  }

  warning(
    warnings,
    "UNSUPPORTED_BLOCK",
    `Desteklenmeyen bos block atlandi: ${node.type ?? "unknown"}`,
    path,
  );
  return [];
}

function mapNodesToBlocks(
  nodes: JSONContent[] | undefined,
  warnings: DocWarning[],
  path: string,
): BlockNode[] {
  const blocks: BlockNode[] = [];

  asArray(nodes).forEach((node, index) => {
    blocks.push(...mapNodeToBlocks(node, warnings, `${path}/content/${index}`));
  });

  return blocks;
}

export function mapEditorJsonToDocModel(content: JSONContent): DocModel {
  const warnings: DocWarning[] = [];
  const root: JSONContent = content.type === "doc"
    ? content
    : {
      type: "doc",
      content: [content],
    };

  const blocks = mapNodesToBlocks(root.content, warnings, "doc");

  if (!blocks.length) {
    warning(
      warnings,
      "EMPTY_DOCUMENT",
      "Belge bos oldugu icin tek bos paragraf eklendi.",
      "doc",
    );
    blocks.push({
      kind: "paragraph",
      alignment: "left",
      inlines: [],
      preserveEmpty: true,
      sourceNodeType: "doc",
    });
  }

  return {
    schemaVersion: 1,
    blocks,
    warnings,
  };
}

export function mapTiptapNodesToDocModel(nodes: JSONContent[]): DocModel {
  return mapEditorJsonToDocModel({
    type: "doc",
    content: nodes,
  });
}

function paragraphToPlainText(paragraph: ParagraphNode): string {
  if (!paragraph.inlines.length) {
    return "";
  }

  return paragraph.inlines
    .map((inline) => {
      if (inline.kind === "tab") return "\t";
      if (inline.kind === "lineBreak") return "\n";
      return inline.text;
    })
    .join("");
}

function tableToPlainText(table: TableNode): string {
  return table.rows
    .map((row) => row.cells
      .map((cell) => cell.paragraphs.map((paragraph) => paragraphToPlainText(paragraph)).join("\n"))
      .join("\t"))
    .join("\n");
}

export function docModelToPlainText(docModel: DocModel): string {
  return docModel.blocks
    .map((block) => {
      if (block.kind === "paragraph") {
        return paragraphToPlainText(block);
      }
      return tableToPlainText(block);
    })
    .join("\n");
}
