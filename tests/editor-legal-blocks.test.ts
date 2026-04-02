import { describe, expect, it } from "vitest";
import {
  buildTableOfContentsContent,
  buildLegalBlockContent,
  findTableOfContentsRange,
  listLegalBlockDefinitions,
} from "@/apps/web/lib/editor/legal-blocks";

describe("editor legal blocks", () => {
  it("exposes supported legal section blocks", () => {
    const definitions = listLegalBlockDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(6);
    expect(definitions.map((item) => item.id)).toContain("subject");
    expect(definitions.map((item) => item.id)).toContain("result_and_claim");
  });

  it("builds evidence block with title and list", () => {
    const nodes = buildLegalBlockContent("evidence");
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[1]?.type).toBe("bulletList");
  });

  it("builds result and claim block with ordered list", () => {
    const nodes = buildLegalBlockContent("result_and_claim");
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[1]?.type).toBe("orderedList");
  });

  it("builds numbered table of contents lines from headings", () => {
    const nodes = buildTableOfContentsContent([
      { level: 1, text: "Giris" },
      { level: 2, text: "Olaylar" },
      { level: 2, text: "Hukuki Nedenler" },
      { level: 1, text: "Sonuc ve Talep" },
    ]);
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[1]?.type).toBe("paragraph");
    expect(nodes[1]?.content?.[0]?.text).toBe("1. Giris");
    expect(nodes[2]?.content?.[0]?.text).toBe("1.1. Olaylar");
    expect(nodes[3]?.content?.[0]?.text).toBe("1.2. Hukuki Nedenler");
    expect(nodes[4]?.content?.[0]?.text).toBe("2. Sonuc ve Talep");
  });

  it("builds empty toc guidance when no headings exist", () => {
    const nodes = buildTableOfContentsContent([]);
    expect(nodes[0]?.type).toBe("paragraph");
    expect(nodes[1]?.type).toBe("paragraph");
    expect(nodes[1]?.content?.[0]?.text).toContain("H1/H2/H3");
  });

  it("finds inserted toc block range among top-level nodes", () => {
    const toc = buildTableOfContentsContent([
      { level: 1, text: "Giris" },
      { level: 2, text: "Detaylar" },
    ]);

    const content = [
      { type: "paragraph", content: [{ type: "text", text: "Onsöz" }] },
      ...toc,
      { type: "paragraph", content: [{ type: "text", text: "Ana metin" }] },
    ];

    const range = findTableOfContentsRange(content);
    expect(range).toEqual({
      startIndex: 1,
      endIndex: 1 + toc.length - 1,
    });
  });

  it("returns null when toc block is not present", () => {
    const range = findTableOfContentsRange([
      { type: "paragraph", content: [{ type: "text", text: "ICINDEKILER:" }] },
      { type: "paragraph", content: [{ type: "text", text: "Serbest metin" }] },
    ]);

    expect(range).toBeNull();
  });
});
