import { describe, expect, it } from "vitest";
import { renderCanonicalToPrintHtml } from "@/apps/api/src/exports/utils/canonical-html-renderer";

describe("canonical html renderer page meta", () => {
  it("renders header, footer and page number when page meta exists", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Page Meta Test",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          pageMeta: {
            headerText: "UST BILGI SATIRI",
            footerText: "ALT BILGI SATIRI",
            showPageNumbers: true,
          },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Belge govdesi" }],
            },
          ],
        },
      },
    });

    expect(html).toContain('class="page-meta-header"');
    expect(html).toContain("UST BILGI SATIRI");
    expect(html).toContain('class="page-meta-footer"');
    expect(html).toContain("ALT BILGI SATIRI");
    expect(html).toContain('class="page-number"');
    expect(html).toContain("Sayfa 1");
  });

  it("does not render page meta wrappers when page meta is absent", () => {
    const html = renderCanonicalToPrintHtml({
      documentTitle: "Page Meta Yok",
      status: "DRAFT",
      generatedAtIso: "2026-03-27T00:00:00.000Z",
      root: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Belge govdesi" }],
            },
          ],
        },
      },
    });

    expect(html).not.toContain('class="page-meta-header"');
    expect(html).not.toContain('class="page-meta-footer"');
    expect(html).not.toContain('class="page-number"');
  });
});
