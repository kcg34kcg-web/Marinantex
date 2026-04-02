import { describe, expect, it } from "vitest";
import { importUdfFile } from "@/apps/web/lib/editor/udf/importUdf";

describe("UDF import limits", () => {
  it("rejects empty files", async () => {
    const file = new File([new Uint8Array(0)], "empty.udf", {
      type: "application/octet-stream",
    });

    await expect(importUdfFile(file)).rejects.toThrow("UDF dosyasi bos.");
  });

  it("rejects files over size limit", async () => {
    const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
    const file = new File([bytes], "large.udf", {
      type: "application/octet-stream",
    });

    await expect(importUdfFile(file)).rejects.toThrow("UDF dosyasi cok buyuk");
  });
});
