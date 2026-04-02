import { describe, expect, it } from "vitest";
import { renderCanonicalToPrintHtml } from "@/apps/api/src/exports/utils/canonical-html-renderer";

describe("canonical html renderer footnotes", () => {
  it("renders footnote references and footnotes section", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Dipnot Testi",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Metin" },
                { type: "footnote", attrs: { content: "Ilk dipnot icerigi" } },
                { type: "text", text: " devam" },
                { type: "footnote", attrs: { content: "Ikinci dipnot" } },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain("[1]");
    expect(html).toContain("[2]");
    expect(html).toContain("<h3>Dipnotlar</h3>");
    expect(html).toContain("<li>Ilk dipnot icerigi</li>");
    expect(html).toContain("<li>Ikinci dipnot</li>");
  });

  it("escapes footnote content in footnotes section", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Dipnot Escape Testi",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Metin" },
                { type: "footnote", attrs: { content: '<img src=x onerror="alert(1)">' } },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x onerror=");
  });
});
