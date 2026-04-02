type MarkType = "bold" | "italic" | "underline" | "strike" | "link";

interface MarkNode {
  type?: MarkType | string;
  attrs?: Record<string, unknown>;
}

interface ContentNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: MarkNode[];
  content?: ContentNode[];
}

interface PrintHtmlInput {
  documentTitle: string;
  status: "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED";
  generatedAtIso: string;
  root: Record<string, unknown>;
}

interface RenderContext {
  footnotes: string[];
}

interface PageMeta {
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeLinkHref(value: unknown): string {
  if (typeof value !== "string") {
    return "#";
  }

  const href = value.trim();
  if (!href) {
    return "#";
  }

  const lower = href.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    href.startsWith("//")
  ) {
    return "#";
  }

  if (href.startsWith("#") || href.startsWith("/")) {
    return href;
  }

  try {
    const parsed = new URL(href);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:" ||
      parsed.protocol === "tel:"
    ) {
      return href;
    }
    return "#";
  } catch {
    return href;
  }
}

function openTag(type: string, attrs?: Record<string, unknown>): string {
  if (type === "heading") {
    const levelRaw = attrs?.level;
    const level =
      typeof levelRaw === "number" && levelRaw >= 1 && levelRaw <= 6
        ? levelRaw
        : 2;
    return `<h${level}${alignStyle(attrs)}>`;
  }
  if (type === "paragraph") {
    return `<p${alignStyle(attrs)}>`;
  }
  if (type === "bulletList") {
    return "<ul>";
  }
  if (type === "orderedList") {
    return `<ol${orderedListStyle(attrs)}>`;
  }
  if (type === "listItem") {
    return "<li>";
  }
  if (type === "blockquote") {
    return "<blockquote>";
  }
  if (type === "doc") {
    return "<article>";
  }
  return "<div>";
}

function closeTag(type: string, attrs?: Record<string, unknown>): string {
  if (type === "heading") {
    const levelRaw = attrs?.level;
    const level =
      typeof levelRaw === "number" && levelRaw >= 1 && levelRaw <= 6
        ? levelRaw
        : 2;
    return `</h${level}>`;
  }
  if (type === "paragraph") {
    return "</p>";
  }
  if (type === "bulletList") {
    return "</ul>";
  }
  if (type === "orderedList") {
    return "</ol>";
  }
  if (type === "listItem") {
    return "</li>";
  }
  if (type === "blockquote") {
    return "</blockquote>";
  }
  if (type === "doc") {
    return "</article>";
  }
  return "</div>";
}

function alignStyle(attrs?: Record<string, unknown>): string {
  const align = attrs?.textAlign;
  if (align === "left" || align === "right" || align === "center" || align === "justify") {
    return ` style="text-align:${align}"`;
  }
  return "";
}

function orderedListStyle(attrs?: Record<string, unknown>): string {
  const listStyleType = attrs?.listStyleType;
  if (
    listStyleType !== "decimal" &&
    listStyleType !== "lower-alpha" &&
    listStyleType !== "upper-alpha" &&
    listStyleType !== "lower-roman" &&
    listStyleType !== "upper-roman"
  ) {
    return "";
  }
  if (listStyleType === "decimal") return "";
  return ` style="list-style-type:${listStyleType}"`;
}

function applyMarks(text: string, marks?: MarkNode[]): string {
  if (!marks || marks.length === 0) {
    return text;
  }

  return marks.reduce((acc, mark) => {
    if (mark.type === "bold") {
      return `<strong>${acc}</strong>`;
    }
    if (mark.type === "italic") {
      return `<em>${acc}</em>`;
    }
    if (mark.type === "underline") {
      return `<u>${acc}</u>`;
    }
    if (mark.type === "strike") {
      return `<s>${acc}</s>`;
    }
    if (mark.type === "link") {
      const href = sanitizeLinkHref(mark.attrs?.href);
      return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${acc}</a>`;
    }
    return acc;
  }, text);
}

function resolvePageMeta(rootNode: ContentNode): PageMeta | null {
  const rootRecord = rootNode as unknown as Record<string, unknown>;
  const raw = rootRecord.pageMeta;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const headerText = typeof candidate.headerText === "string" ? candidate.headerText.trim() : "";
  const footerText = typeof candidate.footerText === "string" ? candidate.footerText.trim() : "";
  const showPageNumbers = candidate.showPageNumbers === true;
  if (!headerText && !footerText && !showPageNumbers) return null;
  return { headerText, footerText, showPageNumbers };
}

function renderNode(node: ContentNode, context: RenderContext): string {
  const type = typeof node.type === "string" ? node.type : "paragraph";

  if (type === "text") {
    const safeText = escapeHtml(node.text ?? "");
    return applyMarks(safeText, node.marks);
  }

  if (type === "hardBreak") {
    return "<br />";
  }

  if (type === "dynamicField") {
    const labelRaw = node.attrs?.label;
    const fallbackRaw = node.attrs?.fieldKey;
    const label =
      typeof labelRaw === "string"
        ? labelRaw
        : typeof fallbackRaw === "string"
          ? fallbackRaw
          : "Alan";
    const valueRaw = node.attrs?.value;
    const value = typeof valueRaw === "string" && valueRaw.length > 0 ? valueRaw : "";
    const rendered = value.length > 0 ? value : `{{${label}}}`;
    return `<span class="dynamic-field">${escapeHtml(rendered)}</span>`;
  }

  if (type === "footnote") {
    const raw = node.attrs?.content;
    const content = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "Dipnot";
    context.footnotes.push(content);
    const index = context.footnotes.length;
    return `<sup class="footnote-ref" data-footnote-index="${index}">[${index}]</sup>`;
  }

  const children = Array.isArray(node.content)
    ? node.content.map((child) => renderNode(child, context)).join("")
    : "";
  return `${openTag(type, node.attrs)}${children}${closeTag(type, node.attrs)}`;
}

export function renderCanonicalToPrintHtml(input: PrintHtmlInput): string {
  const contentCandidate = input.root.content;
  const rootNode =
    contentCandidate && typeof contentCandidate === "object"
      ? (contentCandidate as ContentNode)
      : ({ type: "doc", content: [] } as ContentNode);

  const watermark =
    input.status === "FINAL" || input.status === "ARCHIVED"
      ? ""
      : `<div class="watermark">${escapeHtml(input.status)}</div>`;
  const context: RenderContext = { footnotes: [] };
  const body = renderNode(rootNode, context);
  const pageMeta = resolvePageMeta(rootNode);
  const pageHeaderHtml = pageMeta?.headerText
    ? `<div class="page-meta-header">${escapeHtml(pageMeta.headerText)}</div>`
    : "";
  const footnotesHtml =
    context.footnotes.length > 0
      ? `
      <section class="footnotes">
        <h3>Dipnotlar</h3>
        <ol>
          ${context.footnotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ol>
      </section>
    `
      : "";
  const pageFooterHtml =
    pageMeta && (pageMeta.footerText || pageMeta.showPageNumbers)
      ? `
      <footer class="page-meta-footer">
        <span>${pageMeta.footerText ? escapeHtml(pageMeta.footerText) : ""}</span>
        ${pageMeta.showPageNumbers ? `<span class="page-number">Sayfa 1</span>` : ""}
      </footer>
    `
      : "";

  return `<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.documentTitle)}</title>
    <style>
      @page {
        size: A4;
        margin: 24mm 20mm 24mm 20mm;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        font-family: "Times New Roman", Georgia, serif;
        color: #0f172a;
        background: #f1f5f9;
      }
      .page {
        position: relative;
        width: 794px;
        min-height: 1123px;
        margin: 24px auto;
        background: #fff;
        border: 1px solid #cbd5e1;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
        padding: 32px 36px;
      }
      .meta {
        display: flex;
        justify-content: space-between;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 8px;
        margin-bottom: 20px;
        font-size: 11px;
        color: #475569;
      }
      .meta .title {
        font-weight: 700;
        color: #0f172a;
      }
      .page-meta-header {
        margin-bottom: 14px;
        padding: 8px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        font-size: 12px;
        color: #334155;
      }
      .page-meta-footer {
        margin-top: 18px;
        padding-top: 10px;
        border-top: 1px solid #cbd5e1;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-size: 12px;
        color: #334155;
      }
      .page-number {
        font-weight: 600;
      }
      .watermark {
        position: absolute;
        top: 48%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-20deg);
        font-size: 96px;
        font-weight: 700;
        letter-spacing: 8px;
        color: rgba(148, 163, 184, 0.18);
        pointer-events: none;
        user-select: none;
        z-index: 0;
      }
      article {
        position: relative;
        z-index: 1;
      }
      p {
        margin: 0 0 10px;
        line-height: 1.55;
        font-size: 15px;
      }
      h1, h2, h3, h4, h5, h6 {
        margin: 14px 0 10px;
        line-height: 1.35;
      }
      ul,
      ol {
        margin: 0 0 12px;
        padding-left: 24px;
      }
      li {
        margin-bottom: 6px;
      }
      blockquote {
        border-left: 4px solid #94a3b8;
        margin: 12px 0;
        padding-left: 12px;
        color: #334155;
      }
      .dynamic-field {
        display: inline-block;
        border-bottom: 1px dashed #64748b;
        padding: 0 2px;
        color: #0f172a;
      }
      a {
        color: #1d4ed8;
        text-decoration: underline;
      }
      .footnote-ref {
        font-size: 11px;
        font-weight: 700;
        color: #1e293b;
      }
      .footnotes {
        margin-top: 24px;
        border-top: 1px solid #cbd5e1;
        padding-top: 12px;
      }
      .footnotes h3 {
        margin: 0 0 8px;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #334155;
      }
      .footnotes ol {
        margin: 0;
        padding-left: 20px;
      }
      .footnotes li {
        margin-bottom: 6px;
        font-size: 13px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <section class="page">
      ${watermark}
      <header class="meta">
        <div class="title">${escapeHtml(input.documentTitle)}</div>
        <div>${escapeHtml(input.generatedAtIso)}</div>
      </header>
      ${pageHeaderHtml}
      ${body}
      ${footnotesHtml}
      ${pageFooterHtml}
    </section>
  </body>
</html>`;
}
