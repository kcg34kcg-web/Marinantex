import type { Editor, JSONContent } from "@tiptap/react";
import {
  INTERNAL_UDF_FRAGMENT_MIME,
  type InternalUdfClipboardFragment,
  type PasteOperationResult,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseInternalPayload(raw: string): InternalUdfClipboardFragment | null {
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.schema !== "marinantex.udf-fragment") return null;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.tiptapNodes)) return null;
    if (!isRecord(parsed.docModel)) return null;
    if (!Array.isArray(parsed.docModel.blocks)) return null;
    if (!Array.isArray(parsed.docModel.warnings)) return null;

    return {
      schema: "marinantex.udf-fragment",
      version: 1,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      tiptapNodes: parsed.tiptapNodes as JSONContent[],
      docModel: parsed.docModel as unknown as InternalUdfClipboardFragment["docModel"],
    };
  } catch {
    return null;
  }
}

function looksLikeInternalHtml(html: string): boolean {
  return html.includes('data-marinantex-udf-fragment="1"');
}

function plainTextToNodes(text: string): JSONContent[] {
  const normalized = text.replaceAll("\r\n", "\n");
  return normalized.split("\n").map((line) => {
    if (!line) {
      return { type: "paragraph" };
    }
    return {
      type: "paragraph",
      content: [{ type: "text", text: line }],
    };
  });
}

export function readInternalUdfFragment(
  dataTransfer: DataTransfer,
): InternalUdfClipboardFragment | null {
  const raw = dataTransfer.getData(INTERNAL_UDF_FRAGMENT_MIME);
  return parseInternalPayload(raw);
}

export function pasteInternalUdfFragment(
  editor: Editor,
  dataTransfer: DataTransfer,
): PasteOperationResult {
  const hasFileItem = Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file",
  );

  const custom = readInternalUdfFragment(dataTransfer);
  if (custom?.tiptapNodes.length) {
    editor.chain().focus().insertContent(custom.tiptapNodes).run();
    return {
      handled: true,
      mode: "custom",
      warnings: custom.docModel.warnings.map((item) => item.message),
    };
  }

  const html = dataTransfer.getData("text/html");
  if (html && looksLikeInternalHtml(html)) {
    editor.chain().focus().insertContent(html).run();
    return {
      handled: true,
      mode: "html",
      warnings: [],
    };
  }

  const plain = dataTransfer.getData("text/plain");
  if (!hasFileItem && !custom && !html && plain.trim()) {
    editor.chain().focus().insertContent(plainTextToNodes(plain)).run();
    return {
      handled: true,
      mode: "text",
      warnings: ["Sadece text/plain bulundu; paragraf fallback uygulandi."],
    };
  }

  return {
    handled: false,
    mode: "none",
    warnings: [],
  };
}
