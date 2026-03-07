import type { JSONContent } from "@tiptap/react";
import { mapEditorJsonToDocModel } from "./mapEditorToDocModel";
import type { DocModel, DocWarning } from "./types";
import { buildUdfContentXml } from "./xmlBuilder";
import type { UdfValidationResult } from "./validateUdf";
import { validateUdfArchive, validateUdfContentXml } from "./validateUdf";
import { buildZipArchive } from "./zip";

export interface UdfExportResult {
  archive: Uint8Array;
  contentXml: string;
  docModel: DocModel;
  warnings: DocWarning[];
  validation: UdfValidationResult;
}

function warningsToText(warnings: DocWarning[]): string {
  if (!warnings.length) {
    return "No warnings.";
  }

  return warnings
    .map((item, index) => `${index + 1}. [${item.code}] ${item.path} - ${item.message}`)
    .join("\n");
}

export function exportUdfFromEditorJson(
  content: JSONContent,
  options?: { sourceDocumentId?: string; generatedAt?: string },
): UdfExportResult {
  const docModel = mapEditorJsonToDocModel(content);
  const xml = buildUdfContentXml(docModel);
  const xmlValidation = validateUdfContentXml(xml.contentXml);
  const generatedAt = options?.generatedAt ?? new Date().toISOString();

  const compatibilityManifestXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<manifest>",
    '  <entry path="/" mediaType="application/x-marinantex-udf" />',
    '  <entry path="content.xml" mediaType="text/xml" />',
    '  <entry path="document.xml" mediaType="text/xml" />',
    '  <entry path="manifest.json" mediaType="application/json" />',
    "</manifest>",
  ].join("\n");

  const manifest = {
    schemaVersion: 1,
    format: "Marinantex-UDF-Adapter",
    generatedAt,
    sourceDocumentId: options?.sourceDocumentId ?? null,
    warningCount: docModel.warnings.length,
    validation: {
      contentXmlOk: xmlValidation.ok,
      contentXmlIssueCount: xmlValidation.issues.length,
    },
    bestEffort: true,
    compatibilityAliases: ["document.xml", "META-INF/manifest.xml", "mimetype"],
    notes: [
      "This export is generated via clean-room adapter.",
      "Closed-format compatibility is best-effort and not guaranteed.",
    ],
  };

  const archive = buildZipArchive([
    {
      name: "mimetype",
      data: "application/x-marinantex-udf",
    },
    {
      name: "content.xml",
      data: xml.contentXml,
    },
    {
      name: "document.xml",
      data: xml.contentXml,
    },
    {
      name: "META-INF/manifest.xml",
      data: compatibilityManifestXml,
    },
    {
      name: "manifest.json",
      data: JSON.stringify(manifest, null, 2),
    },
    {
      name: "warnings.txt",
      data: warningsToText(docModel.warnings),
    },
  ]);

  const validation = validateUdfArchive(archive);

  return {
    archive,
    contentXml: xml.contentXml,
    docModel,
    warnings: docModel.warnings,
    validation,
  };
}
