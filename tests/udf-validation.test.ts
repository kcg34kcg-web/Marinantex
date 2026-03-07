import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { exportUdfFromEditorJson } from "@/apps/web/lib/editor/udf/exportUdf";
import { buildZipArchive } from "@/apps/web/lib/editor/udf/zip";
import {
  validateUdfArchive,
  validateUdfContentXml,
} from "@/apps/web/lib/editor/udf/validateUdf";

describe("UDF validation", () => {
  it("validates generated archives successfully", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Dogrulama testi" }],
        },
      ],
    };

    const exported = exportUdfFromEditorJson(input);
    const validation = validateUdfArchive(exported.archive);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toHaveLength(0);
    expect(exported.validation.ok).toBe(true);
  });

  it("reports out-of-range references in malformed content.xml", () => {
    const malformedXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<udfContent schemaVersion="1">',
      "<contentBuffer>abc</contentBuffer>",
      "<body>",
      '<paragraph alignment="left" source="paragraph">',
      '  <text startOffset="5" length="2" />',
      "</paragraph>",
      "</body>",
      "<warnings />",
      "</udfContent>",
    ].join("\n");

    const xmlValidation = validateUdfContentXml(malformedXml);
    expect(xmlValidation.ok).toBe(false);
    expect(
      xmlValidation.issues.some((item) => item.code === "REFERENCE_OUT_OF_RANGE"),
    ).toBe(true);

    const malformedArchive = buildZipArchive([
      { name: "content.xml", data: malformedXml },
      { name: "manifest.json", data: "{}" },
      { name: "warnings.txt", data: "No warnings." },
    ]);

    const archiveValidation = validateUdfArchive(malformedArchive);
    expect(archiveValidation.ok).toBe(false);
    expect(
      archiveValidation.issues.some((item) => item.code === "REFERENCE_OUT_OF_RANGE"),
    ).toBe(true);
  });
});
