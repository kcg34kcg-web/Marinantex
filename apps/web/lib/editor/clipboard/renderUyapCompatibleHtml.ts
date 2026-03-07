import { defaultFontFamily, normalizeFontFamily } from "../udf/font-normalization";
import { docModelToPlainText } from "../udf/mapEditorToDocModel";
import type { DocModel, InlineStyle, ParagraphNode, TableCellNode } from "../udf/types";

export type ClipboardRenderProfile = "uyap" | "internal";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function styleToCss(style: InlineStyle, profile: ClipboardRenderProfile): string {
  const css: string[] = [];
  const normalizedFont = normalizeFontFamily(style.fontFamily);

  if (profile === "uyap") {
    css.push(`font-family:${normalizedFont.normalized}`);
  } else {
    css.push(`font-family:${style.fontFamily || defaultFontFamily()}`);
  }

  if (typeof style.fontSize === "number" && Number.isFinite(style.fontSize)) {
    css.push(`font-size:${Math.max(8, Math.round(style.fontSize))}px`);
  }
  if (style.bold) css.push("font-weight:700");
  if (style.italic) css.push("font-style:italic");
  if (style.underline) css.push("text-decoration:underline");

  return css.join(";");
}

function renderParagraph(
  paragraph: ParagraphNode,
  profile: ClipboardRenderProfile,
): string {
  const paragraphStyle = [
    "margin:0 0 8px 0",
    "line-height:1.5",
    `text-align:${paragraph.alignment}`,
  ].join(";");

  if (!paragraph.inlines.length) {
    return `<p style="${paragraphStyle}">&nbsp;</p>`;
  }

  const inlineHtml = paragraph.inlines
    .map((inline) => {
      if (inline.kind === "lineBreak") {
        return "<br />";
      }
      if (inline.kind === "tab") {
        const css = styleToCss(inline.style, profile);
        return `<span style="${css};white-space:pre;">&nbsp;&nbsp;&nbsp;&nbsp;</span>`;
      }
      const css = styleToCss(inline.style, profile);
      return `<span style="${css}">${esc(inline.text)}</span>`;
    })
    .join("");

  return `<p style="${paragraphStyle}">${inlineHtml}</p>`;
}

function renderCell(
  cell: TableCellNode,
  profile: ClipboardRenderProfile,
): string {
  const cellStyle = [
    "border:1px solid #222",
    "padding:6px",
    "vertical-align:top",
  ].join(";");

  const spanAttrs: string[] = [];
  if (profile === "internal") {
    if (cell.colSpan > 1) spanAttrs.push(`colspan="${cell.colSpan}"`);
    if (cell.rowSpan > 1) spanAttrs.push(`rowspan="${cell.rowSpan}"`);
  }

  const html = cell.paragraphs.map((paragraph) => renderParagraph(paragraph, profile)).join("");
  const attrs = spanAttrs.length ? ` ${spanAttrs.join(" ")}` : "";
  return `<td${attrs} style="${cellStyle}">${html}</td>`;
}

function renderTable(docModel: DocModel, profile: ClipboardRenderProfile): string[] {
  const output: string[] = [];

  for (const block of docModel.blocks) {
    if (block.kind === "paragraph") {
      output.push(renderParagraph(block, profile));
      continue;
    }

    const tableStyle = [
      "border-collapse:collapse",
      "width:100%",
      "table-layout:fixed",
      "margin:0 0 10px 0",
      "border:1px solid #222",
    ].join(";");

    const rows = block.rows
      .map((row) => {
        const cells = row.cells.map((cell) => renderCell(cell, profile)).join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    output.push(`<table style="${tableStyle}"><tbody>${rows}</tbody></table>`);
  }

  return output;
}

export function renderClipboardHtml(
  docModel: DocModel,
  profile: ClipboardRenderProfile,
): string {
  const wrapperStyle = [
    `font-family:${defaultFontFamily()}`,
    "font-size:16px",
    "line-height:1.5",
    "color:#111",
  ].join(";");

  const body = renderTable(docModel, profile).join("");
  if (profile === "internal") {
    return `<div data-marinantex-udf-fragment="1" style="${wrapperStyle}">${body}</div>`;
  }
  return `<div style="${wrapperStyle}">${body}</div>`;
}

export function renderUyapCompatibleHtml(docModel: DocModel): string {
  return renderClipboardHtml(docModel, "uyap");
}

export function renderInternalClipboardHtml(docModel: DocModel): string {
  return renderClipboardHtml(docModel, "internal");
}

export function docModelPlainText(docModel: DocModel): string {
  return docModelToPlainText(docModel);
}
