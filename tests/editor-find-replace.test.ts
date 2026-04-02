import { describe, expect, it } from "vitest";
import {
  findTextMatchRanges,
  isRangeInsideWindow,
  toSafeReplaceRanges,
} from "@/apps/web/lib/editor/find-replace";

describe("editor find/replace ranges", () => {
  it("sorts ranges from end to start for safe in-place replacement", () => {
    const ranges = toSafeReplaceRanges([
      { from: 12, to: 15 },
      { from: 3, to: 6 },
      { from: 8, to: 10 },
    ]);

    expect(ranges).toEqual([
      { from: 12, to: 15 },
      { from: 8, to: 10 },
      { from: 3, to: 6 },
    ]);
  });

  it("filters invalid and overlapping ranges", () => {
    const ranges = toSafeReplaceRanges([
      { from: 5, to: 9 },
      { from: 7, to: 11 },
      { from: 2, to: 2 },
      { from: 0, to: 4 },
      { from: 20, to: 25 },
    ]);

    expect(ranges).toEqual([
      { from: 20, to: 25 },
      { from: 7, to: 11 },
    ]);
  });

  it("supports case sensitive and case insensitive search", () => {
    const insensitive = findTextMatchRanges("Dava dava DAVA", "dava");
    const sensitive = findTextMatchRanges("Dava dava DAVA", "dava", {
      caseSensitive: true,
    });

    expect(insensitive).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 },
      { from: 10, to: 14 },
    ]);
    expect(sensitive).toEqual([{ from: 5, to: 9 }]);
  });

  it("supports whole word matching", () => {
    const ranges = findTextMatchRanges("dava davalık dava_dava dava.", "dava", {
      wholeWord: true,
    });

    expect(ranges).toEqual([
      { from: 0, to: 4 },
      { from: 23, to: 27 },
    ]);
  });

  it("checks whether a range is inside a selection window", () => {
    expect(isRangeInsideWindow({ from: 12, to: 16 }, { from: 10, to: 20 })).toBe(true);
    expect(isRangeInsideWindow({ from: 8, to: 16 }, { from: 10, to: 20 })).toBe(false);
    expect(isRangeInsideWindow({ from: 12, to: 24 }, { from: 10, to: 20 })).toBe(false);
  });
});
