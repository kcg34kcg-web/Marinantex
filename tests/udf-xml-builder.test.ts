import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { mapEditorJsonToDocModel } from "@/apps/web/lib/editor/udf/mapEditorToDocModel";
import {
  EMPTY_PARAGRAPH_PLACEHOLDER,
  buildUdfContentXml,
} from "@/apps/web/lib/editor/udf/xmlBuilder";
import { exportUdfFromEditorJson } from "@/apps/web/lib/editor/udf/exportUdf";

describe("UDF XML builder", () => {
  it("builds content.xml with a global content buffer and offsets", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Baslik" }],
        },
        {
          type: "paragraph",
        },
      ],
    };

    const model = mapEditorJsonToDocModel(input);
    const xml = buildUdfContentXml(model);

    expect(xml.contentBuffer.includes("Baslik")).toBe(true);
    expect(xml.contentBuffer.includes(EMPTY_PARAGRAPH_PLACEHOLDER)).toBe(true);
    expect(xml.contentXml).toContain("<contentBuffer>");
    expect(xml.contentXml).toContain("startOffset=\"0\"");
    expect(xml.contentXml).toContain("placeholder=\"1\"");
  });

  it("creates a zipped udf archive with required files", () => {
    const input: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Deneme" }] }],
    };

    const result = exportUdfFromEditorJson(input, {
      sourceDocumentId: "doc-1",
    });

    expect(result.archive[0]).toBe(0x50);
    expect(result.archive[1]).toBe(0x4b);
    expect(result.contentXml).toContain("<udfContent schemaVersion=\"1\">");
  });
});
