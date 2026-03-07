import type { Editor } from "@tiptap/react";
import { mapTiptapNodesToDocModel } from "../udf/mapEditorToDocModel";
import { legacyClipboardWrite } from "./legacyClipboardWrite";
import { extractSelectionSnapshot } from "./selection";
import {
  docModelPlainText,
  renderInternalClipboardHtml,
} from "./renderUyapCompatibleHtml";
import {
  INTERNAL_UDF_FRAGMENT_MIME,
  type CopyOperationResult,
  type InternalUdfClipboardFragment,
} from "./types";

function warningMessages(messages: string[]): string[] {
  return messages.filter(Boolean);
}

export async function copyInternalUdfFragment(
  editor: Editor,
): Promise<CopyOperationResult> {
  const snapshot = extractSelectionSnapshot(editor);
  const docModel = mapTiptapNodesToDocModel(snapshot.tiptapNodes);
  const payload: InternalUdfClipboardFragment = {
    schema: "marinantex.udf-fragment",
    version: 1,
    createdAt: new Date().toISOString(),
    tiptapNodes: snapshot.tiptapNodes,
    docModel,
  };

  const warnings = warningMessages(docModel.warnings.map((item) => item.message));
  const html = renderInternalClipboardHtml(docModel);
  const plainText = snapshot.selectionText.trim()
    ? snapshot.selectionText
    : docModelPlainText(docModel);

  const customPayload = JSON.stringify(payload);

  const legacyFallback = (): CopyOperationResult => {
    const legacy = legacyClipboardWrite({
      plainText,
      html,
      custom: {
        mime: INTERNAL_UDF_FRAGMENT_MIME,
        value: customPayload,
      },
    });

    if (!legacy.ok) {
      return {
        ok: false,
        mode: "failed",
        warnings: [...warnings, "Legacy clipboard fallback basarisiz oldu."],
      };
    }

    if (legacy.customWritten) {
      return {
        ok: true,
        mode: "rich",
        warnings: warnings,
      };
    }

    if (legacy.htmlWritten) {
      return {
        ok: true,
        mode: "html",
        warnings: [...warnings, "Custom MIME yazilamadi; legacy HTML fallback kullanildi."],
      };
    }

    return {
      ok: true,
      mode: "text",
      warnings: [...warnings, "Sadece text/plain yazilabildi (legacy fallback)."],
    };
  };

  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (typeof ClipboardItem !== "undefined" && clipboard?.write) {
    try {
      const item = new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
        [INTERNAL_UDF_FRAGMENT_MIME]: new Blob([customPayload], {
          type: INTERNAL_UDF_FRAGMENT_MIME,
        }),
      });
      await clipboard.write([item]);
      return {
        ok: true,
        mode: "rich",
        warnings,
      };
    } catch {
      try {
        const fallbackItem = new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        });
        await clipboard.write([fallbackItem]);
        return {
          ok: true,
          mode: "html",
          warnings: [...warnings, "Custom MIME yazilamadi; HTML fallback kullanildi."],
        };
      } catch {
        // continue to plain text fallback
      }
    }
  }

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(plainText);
      return {
        ok: true,
        mode: "text",
        warnings: [...warnings, "Sadece text/plain yazilabildi."],
      };
    } catch {
      return legacyFallback();
    }
  }

  return legacyFallback();
}
