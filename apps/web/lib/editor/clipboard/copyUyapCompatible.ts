import type { Editor } from "@tiptap/react";
import { mapTiptapNodesToDocModel } from "../udf/mapEditorToDocModel";
import { legacyClipboardWrite } from "./legacyClipboardWrite";
import { extractSelectionSnapshot } from "./selection";
import {
  docModelPlainText,
  renderUyapCompatibleHtml,
} from "./renderUyapCompatibleHtml";
import type { CopyOperationResult } from "./types";

export async function copyUyapCompatible(
  editor: Editor,
): Promise<CopyOperationResult> {
  const snapshot = extractSelectionSnapshot(editor);
  const docModel = mapTiptapNodesToDocModel(snapshot.tiptapNodes);
  const warnings = docModel.warnings.map((item) => item.message);

  const html = renderUyapCompatibleHtml(docModel);
  const plainText = snapshot.selectionText.trim()
    ? snapshot.selectionText
    : docModelPlainText(docModel);

  const legacyFallback = (): CopyOperationResult => {
    const legacy = legacyClipboardWrite({
      plainText,
      html,
    });

    if (!legacy.ok) {
      return {
        ok: false,
        mode: "failed",
        warnings: [...warnings, "Legacy clipboard fallback basarisiz oldu."],
      };
    }

    if (legacy.htmlWritten) {
      return {
        ok: true,
        mode: "html",
        warnings,
      };
    }

    return {
      ok: true,
      mode: "text",
      warnings: [...warnings, "HTML yazilamadi; text/plain fallback kullanildi (legacy)."],
    };
  };

  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (typeof ClipboardItem !== "undefined" && clipboard?.write) {
    try {
      const item = new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await clipboard.write([item]);
      return {
        ok: true,
        mode: "html",
        warnings,
      };
    } catch {
      // continue to plain-text fallback
    }
  }

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(plainText);
      return {
        ok: true,
        mode: "text",
        warnings: [...warnings, "HTML yazilamadi; text/plain fallback kullanildi."],
      };
    } catch {
      return legacyFallback();
    }
  }

  return legacyFallback();
}
