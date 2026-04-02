import { describe, expect, it } from "vitest";
import {
  getLegalStylePresetById,
  listLegalStylePresets,
} from "@/apps/web/lib/editor/style-presets";

describe("editor style presets", () => {
  it("exposes legal style presets", () => {
    const presets = listLegalStylePresets();
    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(presets.map((item) => item.id)).toContain("petition_standard");
    expect(presets.map((item) => item.id)).toContain("defense_readable");
  });

  it("looks up presets by id", () => {
    const preset = getLegalStylePresetById("petition_standard");
    expect(preset?.fontSize).toBe("12px");
    expect(getLegalStylePresetById("contract_compact")?.textAlign).toBe("justify");
  });
});
