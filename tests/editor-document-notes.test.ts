import { describe, expect, it } from "vitest";
import {
  collectTopNoteTags,
  filterDocumentNotes,
  normalizeDocumentNotes,
} from "@/apps/web/lib/editor/document-notes";

describe("editor document note normalization", () => {
  it("keeps valid notes, deduplicates and sorts pinned first", () => {
    const notes = normalizeDocumentNotes([
      {
        id: "n-1",
        body: "ilk not",
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        pinned: false,
        tags: ["dava", "DAVA"],
        scope: "PRIVATE",
      },
      {
        id: "n-2",
        body: "ekip notu",
        createdAt: "2026-03-02T10:00:00.000Z",
        pinned: true,
        tags: ["ekip", "acil"],
        scope: "TEAM",
        from: 5,
        to: 12,
      },
      {
        id: "n-1",
        body: "tekrar",
        createdAt: "2026-03-03T10:00:00.000Z",
      },
    ]);

    expect(notes).toHaveLength(2);
    expect(notes[0]?.id).toBe("n-2");
    expect(notes[0]?.scope).toBe("TEAM");
    expect(notes[1]?.tags).toEqual(["dava"]);
  });

  it("drops invalid records and normalizes fallback fields", () => {
    const notes = normalizeDocumentNotes([
      null,
      {},
      { body: "   " },
      {
        body: "serbest not",
        createdAt: "gecersiz",
        updatedAt: "gecersiz",
        pinned: "yes",
        tags: "  Onemli, onemli, Hazirlik ",
        scope: "UNKNOWN",
        from: -5,
        to: 0,
      },
    ]);

    expect(notes).toHaveLength(1);
    expect(notes[0]?.createdAt).toBe(new Date(0).toISOString());
    expect(notes[0]?.updatedAt).toBe(new Date(0).toISOString());
    expect(notes[0]?.scope).toBe("PRIVATE");
    expect(notes[0]?.pinned).toBe(false);
    expect(notes[0]?.tags).toEqual(["onemli", "hazirlik"]);
    expect(notes[0]?.from).toBeUndefined();
    expect(notes[0]?.to).toBeUndefined();
  });

  it("filters notes by query, scope and pinned flags", () => {
    const notes = normalizeDocumentNotes([
      {
        id: "n-1",
        body: "Dava dilekcesi notu",
        createdAt: "2026-03-01T10:00:00.000Z",
        scope: "PRIVATE",
        pinned: false,
        tags: ["dava", "hazirlik"],
      },
      {
        id: "n-2",
        body: "Ekip icin delil listesi",
        createdAt: "2026-03-02T10:00:00.000Z",
        scope: "TEAM",
        pinned: true,
        tags: ["delil"],
      },
    ]);

    expect(
      filterDocumentNotes(notes, { query: "delil" }).map((item) => item.id),
    ).toEqual(["n-2"]);
    expect(
      filterDocumentNotes(notes, { scope: "PRIVATE" }).map((item) => item.id),
    ).toEqual(["n-1"]);
    expect(
      filterDocumentNotes(notes, { pinnedOnly: true }).map((item) => item.id),
    ).toEqual(["n-2"]);
  });

  it("collects most frequent tags for quick filters", () => {
    const notes = normalizeDocumentNotes([
      { id: "n-1", body: "A", createdAt: "2026-03-01T10:00:00.000Z", tags: ["dava", "acil"] },
      { id: "n-2", body: "B", createdAt: "2026-03-02T10:00:00.000Z", tags: ["dava"] },
      { id: "n-3", body: "C", createdAt: "2026-03-03T10:00:00.000Z", tags: ["delil", "acil"] },
    ]);

    expect(collectTopNoteTags(notes, 2)).toEqual(["acil", "dava"]);
  });
});
