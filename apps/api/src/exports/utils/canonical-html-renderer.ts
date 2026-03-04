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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    return "<ol>";
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
      const hrefRaw = mark.attrs?.href;
      const href = typeof hrefRaw === "string" ? hrefRaw : "#";
      return `<a href="${escapeHtml(href)}">${acc}</a>`;
    }
    return acc;
  }, text);
}

function renderNode(node: ContentNode): string {
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

  const children = Array.isArray(node.content)
    ? node.content.map((child) => renderNode(child)).join("")
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
  const body = renderNode(rootNode);

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
    </style>
  </head>
  <body>
    <section class="page">
      ${watermark}
      <header class="meta">
        <div class="title">${escapeHtml(input.documentTitle)}</div>
        <div>${escapeHtml(input.generatedAtIso)}</div>
      </header>
      ${body}
    </section>
  </body>
</html>`;
}
