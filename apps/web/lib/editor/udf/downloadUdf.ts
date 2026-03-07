import type { JSONContent } from "@tiptap/react";
import type { DocWarning } from "./types";
import type { UdfValidationResult } from "./validateUdf";
import { exportUdfFromEditorJson } from "./exportUdf";

function sanitizeBaseName(value: string): string {
  const normalized = value
    .trim()
    .replaceAll(/[^a-zA-Z0-9-_]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return normalized || "belge";
}

function triggerDownload(filename: string, payload: Uint8Array) {
  const bytes = new Uint8Array(payload);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 300);
}

export interface DownloadUdfResult {
  filename: string;
  warnings: DocWarning[];
  validation: UdfValidationResult;
}

export function downloadUdfFromEditorJson(
  content: JSONContent,
  options?: {
    documentId?: string;
    fileBaseName?: string;
  },
): DownloadUdfResult {
  const baseName = sanitizeBaseName(
    options?.fileBaseName ?? options?.documentId ?? "belge",
  );
  const filename = `${baseName}.udf`;
  const exported = exportUdfFromEditorJson(content, {
    sourceDocumentId: options?.documentId,
  });

  triggerDownload(filename, exported.archive);

  return {
    filename,
    warnings: exported.warnings,
    validation: exported.validation,
  };
}
