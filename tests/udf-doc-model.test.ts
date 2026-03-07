import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import {
  docModelToPlainText,
  mapEditorJsonToDocModel,
} from "@/apps/web/lib/editor/udf/mapEditorToDocModel";

describe("UDF doc model mapping", () => {
  it("maps simple paragraphs without losing text", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Merhaba dunya" }],
        },
      ],
    };

    const mapped = mapEditorJsonToDocModel(input);

    expect(mapped.blocks).toHaveLength(1);
    expect(mapped.blocks[0]?.kind).toBe("paragraph");
    expect(docModelToPlainText(mapped)).toBe("Merhaba dunya");
    expect(mapped.warnings).toHaveLength(0);
  });

  it("keeps alignment, tabs and basic marks with font fallback", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            {
              type: "text",
              text: "A\tB",
              marks: [
                { type: "bold" },
                {
                  type: "textStyle",
                  attrs: {
                    fontFamily: "Bilinmeyen Font",
                    fontSize: "18px",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const mapped = mapEditorJsonToDocModel(input);
    const paragraph = mapped.blocks[0];

    if (!paragraph || paragraph.kind !== "paragraph") {
      throw new Error("Expected first block to be paragraph");
    }

    expect(paragraph.alignment).toBe("center");
    expect(paragraph.inlines.map((item) => item.kind)).toEqual(["text", "tab", "text"]);

    const textInline = paragraph.inlines[0];
    if (!textInline || textInline.kind !== "text") {
      throw new Error("Expected text inline");
    }

    expect(textInline.style.bold).toBe(true);
    expect(textInline.style.fontSize).toBe(18);
    expect(textInline.style.fontFamily).toContain("Times New Roman");
    expect(mapped.warnings.some((item) => item.code === "FONT_FALLBACK")).toBe(true);
  });

  it("maps table blocks and warns on merged cells", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: {
                    colspan: 2,
                    rowspan: 2,
                  },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Hucre" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const mapped = mapEditorJsonToDocModel(input);

    expect(mapped.blocks).toHaveLength(1);
    expect(mapped.blocks[0]?.kind).toBe("table");
    expect(mapped.warnings.some((item) => item.code === "TABLE_SPAN_DEGRADED")).toBe(true);
  });

  it("adds a protected empty paragraph for empty docs", () => {
    const input: JSONContent = { type: "doc", content: [] };
    const mapped = mapEditorJsonToDocModel(input);

    expect(mapped.blocks).toHaveLength(1);
    expect(mapped.blocks[0]?.kind).toBe("paragraph");
    expect(mapped.warnings.some((item) => item.code === "EMPTY_DOCUMENT")).toBe(true);
  });
});
