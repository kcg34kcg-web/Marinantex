import type { JSONContent } from "@tiptap/react";

export type DocAlignment = "left" | "center" | "right" | "justify";

export interface InlineStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface TextInline {
  kind: "text";
  text: string;
  style: InlineStyle;
}

export interface TabInline {
  kind: "tab";
  style: InlineStyle;
}

export interface LineBreakInline {
  kind: "lineBreak";
}

export type InlineNode = TextInline | TabInline | LineBreakInline;

export interface ParagraphNode {
  kind: "paragraph";
  alignment: DocAlignment;
  inlines: InlineNode[];
  preserveEmpty: boolean;
  sourceNodeType: string;
}

export interface TableCellNode {
  kind: "tableCell";
  colSpan: number;
  rowSpan: number;
  paragraphs: ParagraphNode[];
}

export interface TableRowNode {
  kind: "tableRow";
  cells: TableCellNode[];
}

export interface TableNode {
  kind: "table";
  border: "single";
  rows: TableRowNode[];
}

export type BlockNode = ParagraphNode | TableNode;

export interface DocWarning {
  code:
    | "UNSUPPORTED_BLOCK"
    | "UNSUPPORTED_INLINE"
    | "UNSUPPORTED_TABLE_NESTING"
    | "TABLE_SPAN_DEGRADED"
    | "FONT_FALLBACK"
    | "EMPTY_DOCUMENT";
  message: string;
  path: string;
}

export interface DocModel {
  schemaVersion: 1;
  blocks: BlockNode[];
  warnings: DocWarning[];
}

export interface SelectionSnapshot {
  tiptapNodes: JSONContent[];
  selectionText: string;
}
