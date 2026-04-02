import { describe, expect, it } from "vitest";
import { renderCanonicalToPrintHtml } from "@/apps/api/src/exports/utils/canonical-html-renderer";

describe("canonical html renderer link safety", () => {
  it("sanitizes javascript URLs", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Test",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "tikla",
                  marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain('href="#"');
    expect(html.toLowerCase()).not.toContain("javascript:alert(1)");
  });

  it("preserves https links", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Test",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "site",
                  marks: [{ type: "link", attrs: { href: "https://example.com" } }],
                },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain('href="https://example.com"');
  });
});
