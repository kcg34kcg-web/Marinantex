import type { JSONContent } from "@tiptap/react";
import type { DocModel } from "../udf/types";

export const INTERNAL_UDF_FRAGMENT_MIME =
  "application/x-marinantex-udf-fragment+json";

export interface InternalUdfClipboardFragment {
  schema: "marinantex.udf-fragment";
  version: 1;
  createdAt: string;
  tiptapNodes: JSONContent[];
  docModel: DocModel;
}

export interface CopyOperationResult {
  ok: boolean;
  mode: "rich" | "html" | "text" | "failed";
  warnings: string[];
}

export interface PasteOperationResult {
  handled: boolean;
  mode: "custom" | "html" | "text" | "none";
  warnings: string[];
}
