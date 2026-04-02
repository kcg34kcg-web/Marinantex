import { describe, expect, it } from "vitest";
import { renderCanonicalToPrintHtml } from "@/apps/api/src/exports/utils/canonical-html-renderer";

describe("canonical html renderer ordered list styles", () => {
  it("renders non-decimal ordered list style", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Liste Stil Test",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { listStyleType: "lower-roman" },
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Bir" }] }],
                },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain('<ol style="list-style-type:lower-roman">');
  });

  it("does not inject style for decimal ordered list", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Liste Stil Decimal",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { listStyleType: "decimal" },
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Iki" }] }],
                },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain("<ol>");
    expect(html).not.toContain("list-style-type:decimal");
  });
});
