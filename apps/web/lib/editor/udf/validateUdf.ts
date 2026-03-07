import { readStoredZipEntryMap } from "./readZip";

export interface UdfValidationIssue {
  severity: "error" | "warning";
  code:
    | "MISSING_ENTRY"
    | "INVALID_XML_ROOT"
    | "MISSING_CONTENT_BUFFER"
    | "MISSING_BODY"
    | "MISSING_BLOCKS"
    | "INVALID_REFERENCE_ATTR"
    | "REFERENCE_OUT_OF_RANGE"
    | "REFERENCE_VALUE_MISMATCH";
  message: string;
}

export interface UdfValidationResult {
  ok: boolean;
  issues: UdfValidationIssue[];
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

function parseAttrMap(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_][a-zA-Z0-9_-]*)="([^"]*)"/g;
  let attrMatch: RegExpExecArray | null = attrRegex.exec(rawAttrs);

  while (attrMatch) {
    const key = attrMatch[1] ?? "";
    const value = attrMatch[2] ?? "";
    attrs[key] = value;
    attrMatch = attrRegex.exec(rawAttrs);
  }

  return attrs;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function validateUdfContentXml(contentXml: string): UdfValidationResult {
  const issues: UdfValidationIssue[] = [];

  if (!contentXml.includes("<udfContent")) {
    issues.push({
      severity: "error",
      code: "INVALID_XML_ROOT",
      message: "content.xml root tag <udfContent> bulunamadi.",
    });
  }

  const contentBufferMatch = /<contentBuffer>([\s\S]*?)<\/contentBuffer>/.exec(contentXml);
  if (!contentBufferMatch) {
    issues.push({
      severity: "error",
      code: "MISSING_CONTENT_BUFFER",
      message: "content.xml icinde <contentBuffer> bulunamadi.",
    });
  }

  const bodyMatch = /<body>([\s\S]*?)<\/body>/.exec(contentXml);
  if (!bodyMatch) {
    issues.push({
      severity: "error",
      code: "MISSING_BODY",
      message: "content.xml icinde <body> bulunamadi.",
    });
  }

  const bodyText = bodyMatch?.[1] ?? "";
  if (bodyMatch && !/<(paragraph|table)\b/.test(bodyText)) {
    issues.push({
      severity: "error",
      code: "MISSING_BLOCKS",
      message: "UDF body icinde paragraf veya tablo bulunamadi.",
    });
  }

  const contentBuffer = decodeXmlEntities(contentBufferMatch?.[1] ?? "");
  const refRegex = /<(text|tab|lineBreak)\s+([^>]*?)\/>/g;
  let refMatch: RegExpExecArray | null = refRegex.exec(contentXml);

  while (refMatch) {
    const tagName = refMatch[1] ?? "text";
    const rawAttrs = refMatch[2] ?? "";
    const attrs = parseAttrMap(rawAttrs);

    const startOffset = parsePositiveInt(attrs.startOffset);
    const length = parsePositiveInt(attrs.length);

    if (startOffset === null || length === null || length <= 0) {
      issues.push({
        severity: "error",
        code: "INVALID_REFERENCE_ATTR",
        message: `${tagName} referansi gecerli startOffset/length icermiyor.`,
      });
      refMatch = refRegex.exec(contentXml);
      continue;
    }

    if (startOffset + length > contentBuffer.length) {
      issues.push({
        severity: "error",
        code: "REFERENCE_OUT_OF_RANGE",
        message: `${tagName} referansi content buffer araligini asiyor (start=${startOffset}, length=${length}).`,
      });
      refMatch = refRegex.exec(contentXml);
      continue;
    }

    const slice = contentBuffer.slice(startOffset, startOffset + length);
    if (tagName === "tab" && slice !== "\t") {
      issues.push({
        severity: "error",
        code: "REFERENCE_VALUE_MISMATCH",
        message: "tab referansi content buffer icinde '\\t' degerini gostermiyor.",
      });
    }
    if (tagName === "lineBreak" && slice !== "\n") {
      issues.push({
        severity: "error",
        code: "REFERENCE_VALUE_MISMATCH",
        message: "lineBreak referansi content buffer icinde '\\n' degerini gostermiyor.",
      });
    }

    refMatch = refRegex.exec(contentXml);
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

export function validateUdfArchive(archive: Uint8Array): UdfValidationResult {
  const issues: UdfValidationIssue[] = [];
  let entryMap: Record<string, Uint8Array>;

  try {
    entryMap = readStoredZipEntryMap(archive);
  } catch {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "MISSING_ENTRY",
          message: "ZIP arsivi okunamadi.",
        },
      ],
    };
  }

  const requiredEntries = ["content.xml", "manifest.json", "warnings.txt"];
  requiredEntries.forEach((entry) => {
    if (!entryMap[entry]) {
      issues.push({
        severity: "error",
        code: "MISSING_ENTRY",
        message: `Arsivde zorunlu dosya eksik: ${entry}`,
      });
    }
  });

  if (entryMap["content.xml"]) {
    const contentXml = new TextDecoder().decode(entryMap["content.xml"]);
    const contentIssues = validateUdfContentXml(contentXml).issues;
    issues.push(...contentIssues);
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
