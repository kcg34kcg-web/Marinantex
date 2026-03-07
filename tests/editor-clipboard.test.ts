import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import {
  INTERNAL_UDF_FRAGMENT_MIME,
} from "@/apps/web/lib/editor/clipboard/types";
import { pasteInternalUdfFragment } from "@/apps/web/lib/editor/clipboard/pasteInternalUdfFragment";

function createMockEditor() {
  const inserted: unknown[] = [];

  const editor = {
    chain() {
      return {
        focus() {
          return {
            insertContent(payload: unknown) {
              inserted.push(payload);
              return {
                run() {
                  return true;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Editor;

  return {
    editor,
    inserted,
  };
}

function createDataTransfer(
  map: Record<string, string>,
  items: Array<{ kind: string; type: string }> = [],
): DataTransfer {
  return {
    getData(type: string) {
      return map[type] ?? "";
    },
    items,
  } as unknown as DataTransfer;
}

describe("Internal clipboard paste", () => {
  it("prefers custom fragment payload when available", () => {
    const { editor, inserted } = createMockEditor();

    const payload = JSON.stringify({
      schema: "marinantex.udf-fragment",
      version: 1,
      createdAt: "2026-03-06T10:00:00.000Z",
      tiptapNodes: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Icerik" }],
        },
      ],
      docModel: {
        schemaVersion: 1,
        blocks: [],
        warnings: [],
      },
    });

    const dataTransfer = createDataTransfer({
      [INTERNAL_UDF_FRAGMENT_MIME]: payload,
      "text/plain": "Icerik",
    });

    const result = pasteInternalUdfFragment(editor, dataTransfer);

    expect(result.handled).toBe(true);
    expect(result.mode).toBe("custom");
    expect(inserted).toHaveLength(1);
  });

  it("uses marked internal html fallback when custom mime is missing", () => {
    const { editor, inserted } = createMockEditor();

    const dataTransfer = createDataTransfer({
      "text/html": '<div data-marinantex-udf-fragment="1"><p>Metin</p></div>',
    });

    const result = pasteInternalUdfFragment(editor, dataTransfer);

    expect(result.handled).toBe(true);
    expect(result.mode).toBe("html");
    expect(inserted[0]).toContain("data-marinantex-udf-fragment");
  });

  it("falls back to plain text paragraphs when only text/plain exists", () => {
    const { editor, inserted } = createMockEditor();

    const dataTransfer = createDataTransfer({
      "text/plain": "ilk satir\nikinci satir",
    });

    const result = pasteInternalUdfFragment(editor, dataTransfer);

    expect(result.handled).toBe(true);
    expect(result.mode).toBe("text");
    expect(inserted).toHaveLength(1);
  });

  it("does not consume plain text when clipboard contains file items", () => {
    const { editor, inserted } = createMockEditor();

    const dataTransfer = createDataTransfer(
      {
        "text/plain": "dosya ile gelen metin",
      },
      [{ kind: "file", type: "image/png" }],
    );

    const result = pasteInternalUdfFragment(editor, dataTransfer);

    expect(result.handled).toBe(false);
    expect(result.mode).toBe("none");
    expect(inserted).toHaveLength(0);
  });
});
