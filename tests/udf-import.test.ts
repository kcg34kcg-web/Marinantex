import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { exportUdfFromEditorJson } from "@/apps/web/lib/editor/udf/exportUdf";
import { importUdfArchive } from "@/apps/web/lib/editor/udf/importUdf";
import {
  docModelToPlainText,
  mapEditorJsonToDocModel,
} from "@/apps/web/lib/editor/udf/mapEditorToDocModel";
import { readStoredZipEntryMap } from "@/apps/web/lib/editor/udf/readZip";
import { buildZipArchive } from "@/apps/web/lib/editor/udf/zip";

describe("UDF import adapter", () => {
  it("imports exported archive and reconstructs editor JSON", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [{ type: "text", text: "Satir-1\tKolon-2" }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Hucre-1" }] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Hucre-2" }] }],
                },
              ],
            },
          ],
        },
      ],
    };

    const exported = exportUdfFromEditorJson(input, { sourceDocumentId: "roundtrip-doc" });
    const imported = importUdfArchive(exported.archive);

    expect(imported.sourceEntry).toBe("content.xml");
    expect(imported.editorJson.type).toBe("doc");
    expect(imported.parserWarnings).toHaveLength(0);

    const originalText = docModelToPlainText(mapEditorJsonToDocModel(input));
    const importedText = docModelToPlainText(mapEditorJsonToDocModel(imported.editorJson));
    expect(importedText).toBe(originalText);
  });

  it("falls back to document.xml when content.xml is absent", () => {
    const input: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Fallback test" }] }],
    };

    const exported = exportUdfFromEditorJson(input, { sourceDocumentId: "fallback-doc" });
    const entryMap = readStoredZipEntryMap(exported.archive);
    const fallbackArchive = buildZipArchive([
      { name: "document.xml", data: entryMap["document.xml"] ?? entryMap["content.xml"] ?? new Uint8Array() },
      { name: "manifest.json", data: entryMap["manifest.json"] ?? "{}" },
      { name: "warnings.txt", data: entryMap["warnings.txt"] ?? "No warnings." },
    ]);

    const imported = importUdfArchive(fallbackArchive);
    expect(imported.sourceEntry).toBe("document.xml");
    expect(imported.editorJson.type).toBe("doc");
  });

  it("returns parser warnings for malformed references but still produces a document", () => {
    const malformedXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<udfContent schemaVersion="1">',
      "<contentBuffer>abc</contentBuffer>",
      "<body>",
      '  <paragraph alignment="left" source="paragraph">',
      '    <text startOffset="99" length="5" />',
      "  </paragraph>",
      "</body>",
      "<warnings />",
      "</udfContent>",
    ].join("\n");

    const archive = buildZipArchive([
      { name: "content.xml", data: malformedXml },
      { name: "manifest.json", data: "{}" },
      { name: "warnings.txt", data: "No warnings." },
    ]);

    const imported = importUdfArchive(archive);
    expect(imported.editorJson.type).toBe("doc");
    expect(imported.parserWarnings.length).toBeGreaterThan(0);
  });
});
