import { describe, expect, it } from "vitest";
import { normalizeDocumentComments } from "@/apps/web/lib/editor/comments";

describe("editor comment normalization", () => {
  it("keeps valid comments, sorts by createdAt desc and removes duplicates", () => {
    const comments = normalizeDocumentComments([
      {
        id: "c-1",
        body: "Ilk yorum",
        selectedText: "metin",
        createdAt: "2026-03-01T10:00:00.000Z",
        resolved: false,
        from: 5,
        to: 12,
      },
      {
        id: "c-2",
        body: "Ikinci yorum",
        selectedText: "metin2",
        createdAt: "2026-03-02T10:00:00.000Z",
        resolved: true,
      },
      {
        id: "c-1",
        body: "Tekrarlanan id",
        selectedText: "x",
        createdAt: "2026-03-03T10:00:00.000Z",
      },
    ]);

    expect(comments).toHaveLength(2);
    expect(comments[0]?.id).toBe("c-2");
    expect(comments[1]?.id).toBe("c-1");
    expect(comments[1]?.from).toBe(5);
    expect(comments[1]?.to).toBe(12);
  });

  it("drops invalid records and normalizes fallback fields", () => {
    const comments = normalizeDocumentComments([
      null,
      {},
      { body: "   " },
      {
        body: "Gecerli yorum",
        selectedText: "",
        createdAt: "gecersiz-tarih",
        resolved: "yes",
        from: -5,
        to: 0,
      },
    ]);

    expect(comments).toHaveLength(1);
    expect(comments[0]?.selectedText).toBe("(secim kaydi yok)");
    expect(comments[0]?.createdAt).toBe(new Date(0).toISOString());
    expect(comments[0]?.resolved).toBe(false);
    expect(comments[0]?.from).toBeUndefined();
    expect(comments[0]?.to).toBeUndefined();
  });
});
