import { describe, expect, it } from "vitest";
import { mapEditorJsonToDocModel } from "@/apps/web/lib/editor/udf/mapEditorToDocModel";
import { renderUyapCompatibleHtml } from "@/apps/web/lib/editor/clipboard/renderUyapCompatibleHtml";

describe("UYAP compatible HTML renderer", () => {
  it("renders inline-style based html with safe font fallback", () => {
    const model = mapEditorJsonToDocModel({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "right" },
          content: [
            {
              type: "text",
              text: "Metin",
              marks: [
                {
                  type: "textStyle",
                  attrs: { fontFamily: "Bilinmeyen Font", fontSize: "17px" },
                },
              ],
            },
          ],
        },
      ],
    });

    const html = renderUyapCompatibleHtml(model);

    expect(html).toContain("font-family:'Times New Roman'");
    expect(html).toContain("text-align:right");
    expect(html).toContain("font-size:17px");
  });

  it("renders simple tables with inline borders", () => {
    const model = mapEditorJsonToDocModel({
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
    });

    const html = renderUyapCompatibleHtml(model);

    expect(html).toContain("<table");
    expect(html).toContain("border-collapse:collapse");
    expect(html).toContain("<td");
  });
});
