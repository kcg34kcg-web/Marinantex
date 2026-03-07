import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  INTERNAL_UDF_FRAGMENT_MIME,
} from "@/apps/web/lib/editor/clipboard/types";
import { pasteInternalUdfFragment } from "@/apps/web/lib/editor/clipboard/pasteInternalUdfFragment";
import { renderUyapCompatibleHtml } from "@/apps/web/lib/editor/clipboard/renderUyapCompatibleHtml";
import { exportUdfFromEditorJson } from "@/apps/web/lib/editor/udf/exportUdf";
import { mapEditorJsonToDocModel } from "@/apps/web/lib/editor/udf/mapEditorToDocModel";
import { readStoredZipEntryMap } from "@/apps/web/lib/editor/udf/readZip";

interface GoldenFixture {
  id: string;
  document: JSONContent;
}

function createMockEditor() {
  const inserted: unknown[] = [];

  const editor = {
    chain() {
      return {
        focus() {
          return {
            insertContent(payload: unknown) {
              inserted.push(payload);
              return {
                run() {
                  return true;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Editor;

  return { editor, inserted };
}

function createDataTransfer(map: Record<string, string>): DataTransfer {
  return {
    getData(type: string) {
      return map[type] ?? "";
    },
    items: [],
  } as unknown as DataTransfer;
}

function loadFixtures(): GoldenFixture[] {
  const fixturePath = path.resolve(
    process.cwd(),
    "tests/fixtures/udf-golden/documents.json",
  );
  const raw = readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw) as GoldenFixture[];
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function extractContentBuffer(contentXml: string): string {
  const match = /<contentBuffer>([\s\S]*?)<\/contentBuffer>/.exec(contentXml);
  if (!match) {
    throw new Error("contentBuffer tag not found");
  }
  return decodeXmlEntities(match[1] ?? "");
}

function assertOffsetIntegrity(contentXml: string) {
  const buffer = extractContentBuffer(contentXml);
  const refRegex = /<(text|tab|lineBreak)\s+[^>]*startOffset="(\d+)"\s+length="(\d+)"[^>]*\/>/g;

  let match: RegExpExecArray | null = refRegex.exec(contentXml);
  while (match) {
    const tagName = match[1] ?? "text";
    const startOffset = Number.parseInt(match[2] ?? "0", 10);
    const length = Number.parseInt(match[3] ?? "0", 10);

    expect(startOffset).toBeGreaterThanOrEqual(0);
    expect(length).toBeGreaterThan(0);
    expect(startOffset + length).toBeLessThanOrEqual(buffer.length);

    const slice = buffer.slice(startOffset, startOffset + length);
    if (tagName === "tab") {
      expect(slice).toBe("\t");
    }
    if (tagName === "lineBreak") {
      expect(slice).toBe("\n");
    }

    match = refRegex.exec(contentXml);
  }
}

describe("UDF compatibility harness (golden fixtures)", () => {
  const fixtures = loadFixtures();
  const expectedScenarioIds = [
    "scenario-01-plain-text-only",
    "scenario-02-bold-italic-underline",
    "scenario-03-font-family-size",
    "scenario-04-alignments",
    "scenario-05-empty-lines",
    "scenario-06-tab-characters",
    "scenario-07-simple-table",
    "scenario-08-multiline-cell",
    "scenario-09-large-document",
    "scenario-10-mixed-formatting-and-table",
  ];

  it("covers all 10 planned compatibility scenarios", () => {
    const fixtureIds = fixtures.map((item) => item.id);
    expect(fixtureIds).toEqual(expectedScenarioIds);
  });

  for (const fixture of fixtures) {
    it(`exports valid udf archive for fixture: ${fixture.id}`, () => {
      const exported = exportUdfFromEditorJson(fixture.document, {
        sourceDocumentId: fixture.id,
        generatedAt: "2026-03-06T00:00:00.000Z",
      });

      const entryMap = readStoredZipEntryMap(exported.archive);
      const decoder = new TextDecoder();

      const contentXml = decoder.decode(entryMap["content.xml"]);
      const manifestText = decoder.decode(entryMap["manifest.json"]);
      const warningsText = decoder.decode(entryMap["warnings.txt"]);

      expect(contentXml).toContain("<udfContent schemaVersion=\"1\">");
      expect(contentXml).toContain("<contentBuffer>");
      expect(entryMap["content.xml"]).toBeDefined();
      expect(entryMap["manifest.json"]).toBeDefined();
      expect(entryMap["warnings.txt"]).toBeDefined();

      const manifest = JSON.parse(manifestText) as {
        generatedAt: string;
        format: string;
        schemaVersion: number;
        sourceDocumentId: string | null;
        bestEffort: boolean;
      };

      expect(manifest.generatedAt).toBe("2026-03-06T00:00:00.000Z");
      expect(manifest.format).toBe("Marinantex-UDF-Adapter");
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.sourceDocumentId).toBe(fixture.id);
      expect(manifest.bestEffort).toBe(true);

      assertOffsetIntegrity(contentXml);

      expect(contentXml).toMatchSnapshot(`${fixture.id}.content.xml`);
      expect(warningsText).toMatchSnapshot(`${fixture.id}.warnings.txt`);
    });

    it(`validates clipboard compatibility paths for fixture: ${fixture.id}`, () => {
      const model = mapEditorJsonToDocModel(fixture.document);
      const uyapHtml = renderUyapCompatibleHtml(model);
      expect(uyapHtml).toContain("<div");
      expect(uyapHtml).toContain("font-family:");

      const { editor, inserted } = createMockEditor();
      const payload = JSON.stringify({
        schema: "marinantex.udf-fragment",
        version: 1,
        createdAt: "2026-03-06T00:00:00.000Z",
        tiptapNodes: fixture.document.content ?? [],
        docModel: model,
      });

      const dataTransfer = createDataTransfer({
        [INTERNAL_UDF_FRAGMENT_MIME]: payload,
        "text/plain": "fallback",
      });

      const result = pasteInternalUdfFragment(editor, dataTransfer);
      expect(result.handled).toBe(true);
      expect(result.mode).toBe("custom");
      expect(inserted).toHaveLength(1);
    });
  }
});
