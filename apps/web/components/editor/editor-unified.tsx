"use client";

import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import {
  BubbleMenu,
  EditorContent,
  FloatingMenu,
  type Editor,
  type JSONContent,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAW_DATA } from "@/lib/laws";
import {
  copyInternalUdfFragment,
  copyUyapCompatible,
  pasteInternalUdfFragment,
} from "../../lib/editor/clipboard";
import {
  buildTableOfContentsContent,
  buildLegalBlockContent,
  findTableOfContentsRange,
  listLegalBlockDefinitions,
} from "../../lib/editor/legal-blocks";
import {
  findTextMatchRanges,
  isRangeInsideWindow,
  toSafeReplaceRanges,
} from "../../lib/editor/find-replace";
import {
  normalizeDocumentComments,
  type DocumentComment,
} from "../../lib/editor/comments";
import {
  collectTopNoteTags,
  filterDocumentNotes,
  normalizeDocumentNotes,
  type DocumentNote,
  type DocumentNoteScope,
} from "../../lib/editor/document-notes";
import {
  getLegalStylePresetById,
  listLegalStylePresets,
  type LegalStylePresetId,
} from "../../lib/editor/style-presets";
import { downloadUdfFromEditorJson, importUdfFile } from "../../lib/editor/udf";

type Layout = "embedded" | "full";
type DocStatus = "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED";
type ExportStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "EXPIRED";
type SharePermission = "VIEW" | "COMMENT";
type SaveState = "idle" | "saving" | "saved" | "error" | "offline";
type OrderedListStyleValue =
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman";
type ToolbarMenu =
  | "typography"
  | "color"
  | "table"
  | "insert"
  | "layout"
  | "view"
  | "references"
  | "outline"
  | null;

interface MentionItem {
  id: string;
  label: string;
  text: string;
}

interface MentionPreview {
  id: string;
  label: string;
  text: string;
  pos: number;
  top: number;
  left: number;
}

interface MentionUi {
  query: string;
  from: number;
  to: number;
  top: number;
  left: number;
  selected: number;
  items: MentionItem[];
}

interface OutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

interface FindMatch {
  from: number;
  to: number;
  preview: string;
}

interface FindSelectionWindow {
  from: number;
  to: number;
}

interface DocumentPageMeta {
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
}
interface TemplateItem {
  id: string;
  name: string;
  documentType: string;
  schemaVersion: number;
  canonicalJson: {
    content?: JSONContent;
    [key: string]: unknown;
  };
}

interface ClauseItem {
  id: string;
  title: string;
  category: string;
  bodyJson: JSONContent;
}

interface ExportItem {
  id: string;
  format: "PDF" | "DOCX";
  status: ExportStatus;
  createdAt?: string;
  completedAt?: string | null;
  expiresAt?: string | null;
  fileSizeBytes?: number | null;
  failureReason?: string | null;
}

interface ShareLinkItem {
  id: string;
  permission: SharePermission;
  expiresAt: string;
  createdAt?: string;
  maxViews?: number | null;
  viewCount?: number;
  lastAccessedAt?: string | null;
  revokedAt?: string | null;
  publicUrl?: string;
}

interface DocumentVersionItem {
  id: string;
  versionNumber: number;
  schemaVersion: number;
  snapshotHash: string;
  isFinalSnapshot: boolean;
  createdById: string;
  createdAt: string;
}

interface LockSnapshot {
  id: string;
  userId: string;
  acquiredAt: string;
  expiresAt: string;
}

interface CollaborationPeer {
  id: string;
  updatedAt: number;
  mode: "edit" | "preview";
}

interface SuggestionItem {
  id: string;
  selectedText: string;
  proposedText: string;
  note: string;
  createdAt: string;
}

interface DocumentListItem {
  id: string;
  title: string;
  status: DocStatus;
  updatedAt: string;
  source: "local" | "remote";
}

interface LocalDocumentRecord {
  id: string;
  title: string;
  status?: DocStatus;
  updatedAt?: string;
}

export interface EditorUnifiedProps {
  documentId?: string;
  layout?: Layout;
  initialContent?: JSONContent;
  lawItems?: MentionItem[];
  readOnly?: boolean;
  enableLegacyEvents?: boolean;
  onReady?: (editor: Editor) => void;
  onChange?: (data: { json: JSONContent; html: string; text: string }) => void;
}

const DEFAULT_DOC_ID = "local-draft-document";
const INITIAL_CONTENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Belge metnini yazin..." }] }],
};
const LOCAL_MENTIONS: MentionItem[] = LAW_DATA;
const LOCAL_TEMPLATES: TemplateItem[] = [
  {
    id: "t1",
    name: "Dilekce",
    documentType: "PETITION",
    schemaVersion: 1,
    canonicalJson: {
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "ASLIYE HUKUK MAHKEMESINE" }] },
          { type: "paragraph", content: [{ type: "text", text: "Konu: Dava dilekcesidir." }] },
        ],
      },
    },
  },
];
const LOCAL_CLAUSES: ClauseItem[] = [
  {
    id: "c1",
    title: "Yetkili Mahkeme",
    category: "DISPUTE",
    bodyJson: { type: "paragraph", content: [{ type: "text", text: "Yetkili mahkeme Istanbul Mahkemeleridir." }] },
  },
];
const LOCAL_DYNAMIC_FIELDS = [
  { fieldKey: "client_name", label: "Muvekkil Adi", defaultValue: "" },
  { fieldKey: "case_no", label: "Dosya No", defaultValue: "" },
  { fieldKey: "court_name", label: "Mahkeme", defaultValue: "" },
  { fieldKey: "hearing_date", label: "Durusma Tarihi", defaultValue: "" },
] as const;
const LEGAL_BLOCKS = listLegalBlockDefinitions();
const LEGAL_STYLE_PRESETS = listLegalStylePresets();
const QUICK_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#CCCCCC",
  "#C00000", "#E67E22", "#F1C40F", "#2E7D32", "#1ABC9C",
  "#1976D2", "#283593", "#6A1B9A", "#AD1457", "#FFFFFF",
];
const LOCAL_DOCUMENT_INDEX_KEY = "editor-unified:document-index";
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const DOC_STATUS_TRANSITIONS: Record<DocStatus, DocStatus[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["DRAFT", "ARCHIVED", "FINAL"],
  FINAL: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};
const ORDERED_LIST_STYLE_VALUES = [
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
] as const;

function toSafeDate(input?: string): number {
  if (!input) return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(input?: string | null): string {
  if (!input) return "-";
  const value = new Date(input);
  if (!Number.isFinite(value.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function extractTemplateContent(template: TemplateItem): JSONContent | null {
  const raw = template.canonicalJson?.content;
  if (raw && typeof raw === "object") {
    return raw;
  }
  return null;
}

function fallbackDocumentTitle(docId: string): string {
  if (!docId || docId === DEFAULT_DOC_ID || docId === "new") return "Yeni Belge";
  if (docId.startsWith("local-")) return `Yerel Belge ${docId.slice(6, 10)}`;
  return `Belge ${docId.slice(0, 8)}`;
}

function deriveDocumentTitle(text: string, docId: string): string {
  const firstLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine || firstLine === "Belge metnini yazin...") return fallbackDocumentTitle(docId);
  return firstLine.slice(0, 80);
}

function normalizePickerColor(color: string, fallback: string): string {
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(color) ? color : fallback;
}

function parseCssPixel(input: unknown, fallback = 0): number {
  if (typeof input !== "string" || !input.trim()) return fallback;
  const parsed = Number.parseFloat(input.replace("px", "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizePageMeta(input: {
  headerText?: unknown;
  footerText?: unknown;
  showPageNumbers?: unknown;
}): DocumentPageMeta | null {
  const headerText = typeof input.headerText === "string" ? input.headerText.trim() : "";
  const footerText = typeof input.footerText === "string" ? input.footerText.trim() : "";
  const showPageNumbers = input.showPageNumbers === true;
  if (!headerText && !footerText && !showPageNumbers) return null;
  return { headerText, footerText, showPageNumbers };
}

function extractPageMetaFromContent(content: unknown): DocumentPageMeta | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const root = content as Record<string, unknown>;
  if (!root.pageMeta || typeof root.pageMeta !== "object" || Array.isArray(root.pageMeta)) {
    return null;
  }
  return normalizePageMeta(root.pageMeta as Record<string, unknown>);
}

function extractDocumentCommentsFromContent(content: unknown): DocumentComment[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) return [];
  const root = content as Record<string, unknown>;
  return normalizeDocumentComments(root.comments);
}

function extractDocumentNotesFromContent(content: unknown): DocumentNote[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) return [];
  const root = content as Record<string, unknown>;
  return normalizeDocumentNotes(root.notes);
}

function stripEditorMetaFromContent(content: unknown): JSONContent | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const root = content as Record<string, unknown>;
  const { pageMeta: _pageMeta, comments: _comments, notes: _notes, ...withoutMeta } = root;
  return withoutMeta as JSONContent;
}

function withEditorMeta(
  content: JSONContent,
  pageMeta: DocumentPageMeta | null,
  comments: DocumentComment[],
  notes: DocumentNote[],
): Record<string, unknown> {
  const root =
    content && typeof content === "object" && !Array.isArray(content)
      ? { ...(content as Record<string, unknown>) }
      : ({ type: "doc", content: [] } as Record<string, unknown>);
  if (pageMeta) {
    root.pageMeta = pageMeta;
  } else {
    delete root.pageMeta;
  }
  if (comments.length > 0) {
    root.comments = comments;
  } else {
    delete root.comments;
  }
  if (notes.length > 0) {
    root.notes = notes;
  } else {
    delete root.notes;
  }
  return root;
}

function resolveCanonicalContent(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const nested = root.content;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }
  return root;
}

function normalizeEditorLinkHref(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!SAFE_LINK_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOrderedListStyle(value: unknown): OrderedListStyleValue {
  if (
    typeof value === "string" &&
    (ORDERED_LIST_STYLE_VALUES as readonly string[]).includes(value)
  ) {
    return value as OrderedListStyleValue;
  }
  return "decimal";
}

function parseNoteTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  raw.split(",").forEach((piece) => {
    const normalized = piece.trim().toLocaleLowerCase("tr");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    tags.push(normalized);
  });
  return tags.slice(0, 8);
}

function readLocalDocumentIndex(): LocalDocumentRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_DOCUMENT_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalDocumentRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: String(item.id || ""),
        title: String(item.title || "").trim(),
        status: item.status,
        updatedAt: item.updatedAt,
      }))
      .filter((item) => item.id)
      .map((item) => ({
        id: item.id,
        title: item.title || fallbackDocumentTitle(item.id),
        status: item.status && ["DRAFT", "REVIEW", "FINAL", "ARCHIVED"].includes(item.status) ? item.status : "DRAFT",
        updatedAt: item.updatedAt || new Date(0).toISOString(),
      }))
      .sort((a, b) => toSafeDate(b.updatedAt) - toSafeDate(a.updatedAt));
  } catch {
    return [];
  }
}

function readApiCtx() {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("mx_access_token");
  const tenantId = window.localStorage.getItem("mx_tenant_id");
  return {
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:4000",
    token,
    tenantId,
  };
}

function buildApiAuthHeaders(ctx: {
  token: string | null;
  tenantId: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (ctx.token) {
    headers.Authorization = `Bearer ${ctx.token}`;
  }
  if (ctx.tenantId) {
    headers["x-tenant-id"] = ctx.tenantId;
  }
  return headers;
}

async function probeApiAvailability(
  ctx: ReturnType<typeof readApiCtx>,
): Promise<boolean> {
  if (!ctx) return false;
  try {
    const response = await fetch(`${ctx.apiBaseUrl}/auth/me`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: buildApiAuthHeaders(ctx),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T | null> {
  const ctx = readApiCtx();
  if (!ctx) return null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
    ...buildApiAuthHeaders(ctx),
  };
  const response = await fetch(`${ctx.apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) throw new Error(String(response.status));
  const body = await response.text();
  return body ? (JSON.parse(body) as T) : null;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function snippetHtml(title: string, content: string): string {
  return `<blockquote><strong>${esc(title || "Alinti")}</strong><br/>${esc(content).replaceAll("\n", "<br/>")}</blockquote><p></p>`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 250);
}

function mentionUi(editor: Editor, source: MentionItem[]): MentionUi | null {
  const { from, empty } = editor.state.selection;
  if (!empty) return null;
  const text = editor.state.doc.textBetween(Math.max(0, from - 120), from, "\n", "\0");
  const match = /(?:^|\s)@([\p{L}0-9_-]*)$/u.exec(text);
  if (!match) return null;
  const rawQuery = match[1] ?? "";
  const query = rawQuery.toLocaleLowerCase("tr");
  const items = source.filter((x) => `${x.label} ${x.text}`.toLocaleLowerCase("tr").includes(query)).slice(0, 6);
  if (!items.length) return null;
  const coords = editor.view.coordsAtPos(from);
  return {
    query: rawQuery,
    from: from - (rawQuery.length + 1),
    to: from,
    top: coords.bottom + 6,
    left: coords.left,
    selected: 0,
    items,
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: { insertFootnote: (content: string) => ReturnType };
    lawMention: { insertLawMention: (attrs: { id: string; label: string; text: string }) => ReturnType };
    dynamicField: { insertDynamicField: (attrs: { fieldKey: string; label: string; value: string }) => ReturnType };
  }
}

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.fontSize || null,
          renderHTML: (attrs: { fontSize?: string | null }) => (attrs.fontSize ? { style: `font-size:${attrs.fontSize}` } : {}),
        },
      },
    }];
  },
});

const BlockLayout = Extension.create({
  name: "blockLayout",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.lineHeight || null,
            renderHTML: (attrs: { lineHeight?: string | null }) =>
              attrs.lineHeight ? { style: `line-height:${attrs.lineHeight}` } : {},
          },
          marginTop: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.marginTop || null,
            renderHTML: (attrs: { marginTop?: string | null }) =>
              attrs.marginTop ? { style: `margin-top:${attrs.marginTop}` } : {},
          },
          marginBottom: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.marginBottom || null,
            renderHTML: (attrs: { marginBottom?: string | null }) =>
              attrs.marginBottom ? { style: `margin-bottom:${attrs.marginBottom}` } : {},
          },
          marginLeft: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.marginLeft || null,
            renderHTML: (attrs: { marginLeft?: string | null }) =>
              attrs.marginLeft ? { style: `margin-left:${attrs.marginLeft}` } : {},
          },
        },
      },
    ];
  },
});

const OrderedListStyle = Extension.create({
  name: "orderedListStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["orderedList"],
        attributes: {
          listStyleType: {
            default: "decimal",
            parseHTML: (el: HTMLElement) => {
              const styleRaw = el.style.listStyleType?.trim().toLowerCase();
              return normalizeOrderedListStyle(styleRaw);
            },
            renderHTML: (attrs: { listStyleType?: string | null }) => {
              const listStyleType = normalizeOrderedListStyle(attrs.listStyleType);
              if (listStyleType === "decimal") return {};
              return { style: `list-style-type:${listStyleType}` };
            },
          },
        },
      },
    ];
  },
});

const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() { return { content: { default: "" } }; },
  parseHTML() { return [{ tag: "sup[data-footnote]" }]; },
  renderHTML({ HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-footnote": "",
        title: HTMLAttributes.content,
        contenteditable: "false",
      }),
    ];
  },
  addCommands() { return { insertFootnote: (content) => ({ commands }) => commands.insertContent({ type: "footnote", attrs: { content } }) }; },
});

const LawMention = Node.create({
  name: "lawMention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() { return { id: { default: "" }, label: { default: "" }, text: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-law-mention]" }]; },
  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as { id: string; label: string; text: string };
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-law-mention": "true",
        "data-law-id": attrs.id,
        "data-law-label": attrs.label,
        "data-law-text": attrs.text,
        class: "law-mention-node",
        title: attrs.text,
        contenteditable: "false",
      }),
      `@${attrs.label}`,
    ];
  },
  addCommands() { return { insertLawMention: (attrs) => ({ commands }) => commands.insertContent({ type: "lawMention", attrs }) }; },
});

const DynamicField = Node.create({
  name: "dynamicField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      fieldKey: { default: "" },
      label: { default: "Field" },
      value: { default: "" },
    };
  },
  parseHTML() { return [{ tag: "span[data-dynamic-field]" }]; },
  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as { label: string; value: string };
    const value = attrs.value ? `: ${attrs.value}` : "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-dynamic-field": "true",
        class: "dynamic-field-node",
        contenteditable: "false",
      }),
      `{{${attrs.label}${value}}}`,
    ];
  },
  addCommands() {
    return {
      insertDynamicField: (attrs) => ({ commands }) => commands.insertContent({ type: "dynamicField", attrs }),
    };
  },
});

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Button({
  label,
  onClick,
  active,
  disabled,
  variant = "ghost",
  className,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  variant?: "ghost" | "secondary" | "primary";
  className?: string;
}) {
  const variantClass =
    variant === "primary"
      ? "border-transparent bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500"
      : variant === "secondary"
        ? "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-blue-500"
        : active
          ? "border-slate-300 bg-slate-100 text-slate-900 focus-visible:ring-blue-500"
          : "border-transparent bg-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-blue-500";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center rounded-lg border px-3 text-xs font-medium leading-none whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        variantClass,
        disabled ? "cursor-not-allowed opacity-45" : "",
        className,
      )}
    >
      {label}
    </button>
  );
}

export default function EditorUnified({
  documentId,
  layout = "embedded",
  initialContent,
  lawItems,
  readOnly = false,
  enableLegacyEvents = true,
  onReady,
  onChange,
}: EditorUnifiedProps) {
  const docId = documentId?.trim() || DEFAULT_DOC_ID;
  const draftKey = `editor-unified:draft:${docId}`;
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [status, setStatus] = useState<DocStatus>("DRAFT");
  const [wordCount, setWordCount] = useState(0);
  const [message, setMessage] = useState("");
  const [remoteMentionItems, setRemoteMentionItems] = useState<MentionItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>(LOCAL_TEMPLATES);
  const [clauses, setClauses] = useState<ClauseItem[]>(LOCAL_CLAUSES);
  const [exports, setExports] = useState<ExportItem[]>([]);
  const [links, setLinks] = useState<ShareLinkItem[]>([]);
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);
  const [localDocuments, setLocalDocuments] = useState<DocumentListItem[]>([]);
  const [remoteDocuments, setRemoteDocuments] = useState<DocumentListItem[]>([]);
  const [newLink, setNewLink] = useState("");
  const [permission, setPermission] = useState<SharePermission>("VIEW");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mention, setMention] = useState<MentionUi | null>(null);
  const [mentionPreview, setMentionPreview] = useState<MentionPreview | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isFindBarOpen, setIsFindBarOpen] = useState(false);
  const [openToolbarMenu, setOpenToolbarMenu] = useState<ToolbarMenu>(null);
  const [hasWriteLease, setHasWriteLease] = useState(true);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [wordGoal, setWordGoal] = useState(900);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [showPageNumbers, setShowPageNumbers] = useState(false);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [findInSelection, setFindInSelection] = useState(false);
  const [findIncludeNotes, setFindIncludeNotes] = useState(false);
  const [findSelectionWindow, setFindSelectionWindow] = useState<FindSelectionWindow | null>(null);
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [activeFindMatch, setActiveFindMatch] = useState(-1);
  const [documentComments, setDocumentComments] = useState<DocumentComment[]>([]);
  const [documentNotes, setDocumentNotes] = useState<DocumentNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteTagsDraft, setNoteTagsDraft] = useState("");
  const [noteScope, setNoteScope] = useState<DocumentNoteScope>("PRIVATE");
  const [noteAttachSelection, setNoteAttachSelection] = useState(true);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSearchScope, setNoteSearchScope] = useState<"ALL" | DocumentNoteScope>("ALL");
  const [noteSearchPinnedOnly, setNoteSearchPinnedOnly] = useState(false);
  const [activeInspectorTab, setActiveInspectorTab] = useState<
    "workflow" | "versions" | "exports" | "shares" | "library" | "collab" | "suggestions" | "comments" | "notes"
  >("workflow");
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [requestingExportFormat, setRequestingExportFormat] = useState<"pdf" | "docx" | null>(null);
  const [creatingShareLink, setCreatingShareLink] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [peerSessions, setPeerSessions] = useState<CollaborationPeer[]>([]);
  const [currentLock, setCurrentLock] = useState<LockSnapshot | null>(null);
  const mentionRef = useRef<MentionUi | null>(null);
  const autosaveRef = useRef<number | null>(null);
  const lockRefreshRef = useRef<number | null>(null);
  const presenceChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionIdRef = useRef(`session-${Math.random().toString(36).slice(2, 12)}`);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const udfInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const findQueryRef = useRef("");
  const findCaseSensitiveRef = useRef(false);
  const findWholeWordRef = useRef(false);
  const findInSelectionRef = useRef(false);
  const findSelectionWindowRef = useRef<FindSelectionWindow | null>(null);
  const hydratedDraftRef = useRef(false);
  const commentsHydratedRef = useRef(false);
  const lastToastRef = useRef<{ text: string; at: number } | null>(null);
  const mentionSource = useMemo(
    () => [
      ...(lawItems && lawItems.length ? lawItems : LOCAL_MENTIONS),
      ...remoteMentionItems,
    ],
    [lawItems, remoteMentionItems],
  );
  const canonicalPageMeta = useMemo(
    () =>
      normalizePageMeta({
        headerText,
        footerText,
        showPageNumbers,
      }),
    [footerText, headerText, showPageNumbers],
  );
  const canonicalComments = useMemo(
    () => normalizeDocumentComments(documentComments),
    [documentComments],
  );
  const canonicalNotes = useMemo(
    () => normalizeDocumentNotes(documentNotes),
    [documentNotes],
  );
  const noteQuickTags = useMemo(
    () => collectTopNoteTags(documentNotes, 6),
    [documentNotes],
  );
  const filteredDocumentNotes = useMemo(
    () =>
      filterDocumentNotes(documentNotes, {
        query: noteSearchQuery,
        scope: noteSearchScope,
        pinnedOnly: noteSearchPinnedOnly,
      }),
    [documentNotes, noteSearchPinnedOnly, noteSearchQuery, noteSearchScope],
  );
  const findMatchedNotes = useMemo(
    () => {
      if (!findIncludeNotes) return [];
      const query = findQuery.trim();
      if (!query) return [];
      return filterDocumentNotes(documentNotes, {
        query,
        scope: "ALL",
        pinnedOnly: false,
      }).slice(0, 12);
    },
    [documentNotes, findIncludeNotes, findQuery],
  );

  const updateMention = useCallback((value: MentionUi | null) => { mentionRef.current = value; setMention(value); }, []);

  const syncLocalDocument = useCallback((next: {
    id: string;
    title?: string;
    status?: DocStatus;
    updatedAt?: string;
  }) => {
    if (typeof window === "undefined") return;
    setLocalDocuments((prev) => {
      const now = next.updatedAt || new Date().toISOString();
      const index = prev.findIndex((item) => item.id === next.id);
      const existing = index >= 0 ? prev[index] : null;
      const merged: DocumentListItem = {
        id: next.id,
        title: (next.title || existing?.title || fallbackDocumentTitle(next.id)).trim(),
        status: next.status || existing?.status || "DRAFT",
        updatedAt: now,
        source: "local",
      };
      const updated = index >= 0
        ? prev.map((item, idx) => (idx === index ? merged : item))
        : [...prev, merged];
      updated.sort((a, b) => toSafeDate(b.updatedAt) - toSafeDate(a.updatedAt));
      const trimmed = updated.slice(0, 60);
      window.localStorage.setItem(
        LOCAL_DOCUMENT_INDEX_KEY,
        JSON.stringify(trimmed.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          updatedAt: item.updatedAt,
        }))),
      );
      return trimmed;
    });
  }, []);

  const collectOutlineItems = useCallback((instance: Editor): OutlineItem[] => {
    const next: OutlineItem[] = [];
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name !== "heading") return;
      const text = node.textContent.trim();
      if (!text) return;
      const level = Number(node.attrs.level) || 1;
      next.push({
        id: `h-${pos}-${text.slice(0, 12)}`,
        level,
        text,
        pos: pos + 1,
      });
    });
    return next;
  }, []);

  const collectFindMatches = useCallback((
    instance: Editor,
    query: string,
    options?: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      selectionWindow?: FindSelectionWindow | null;
    },
  ): FindMatch[] => {
    const needle = query.trim();
    if (!needle) return [];
    const next: FindMatch[] = [];
    instance.state.doc.descendants((node, pos) => {
      const text = node.text;
      if (!node.isText || !text) return;
      const ranges = findTextMatchRanges(text, needle, {
        caseSensitive: options?.caseSensitive,
        wholeWord: options?.wholeWord,
        locale: "tr",
      });
      ranges.forEach((range) => {
        const from = pos + range.from;
        const to = pos + range.to;
        if (options?.selectionWindow && !isRangeInsideWindow({ from, to }, options.selectionWindow)) {
          return;
        }
        const previewStart = Math.max(0, range.from - 20);
        const previewEnd = Math.min(text.length, range.to + 20);
        next.push({
          from,
          to,
          preview: text.slice(previewStart, previewEnd),
        });
      });
    });
    return next;
  }, []);

  useEffect(() => {
    if (layout !== "full" || typeof window === "undefined") return;
    const goalKey = `editor:word-goal:${docId}`;
    const focusKey = `editor:focus-mode:${docId}`;
    const pageMetaKey = `editor:page-meta:${docId}`;
    const rawGoal = window.localStorage.getItem(goalKey);
    const rawFocus = window.sessionStorage.getItem(focusKey);
    const rawPageMeta = window.localStorage.getItem(pageMetaKey);
    if (rawGoal) {
      const parsed = Number.parseInt(rawGoal, 10);
      if (Number.isFinite(parsed) && parsed >= 0) setWordGoal(parsed);
    }
    if (rawFocus === "1") setIsFocusMode(true);
    if (rawPageMeta) {
      try {
        const parsed = JSON.parse(rawPageMeta) as {
          zoomLevel?: number;
          headerText?: string;
          footerText?: string;
          showPageNumbers?: boolean;
        };
        if (typeof parsed.zoomLevel === "number") {
          setZoomLevel(clampNumber(parsed.zoomLevel, 60, 180));
        }
        if (typeof parsed.headerText === "string") {
          setHeaderText(parsed.headerText);
        }
        if (typeof parsed.footerText === "string") {
          setFooterText(parsed.footerText);
        }
        if (typeof parsed.showPageNumbers === "boolean") {
          setShowPageNumbers(parsed.showPageNumbers);
        }
      } catch {
        // Ignore malformed stored data.
      }
    }
  }, [docId, layout]);

  useEffect(() => {
    if (layout !== "full" || typeof window === "undefined") return;
    window.localStorage.setItem(`editor:word-goal:${docId}`, String(wordGoal));
    window.sessionStorage.setItem(`editor:focus-mode:${docId}`, isFocusMode ? "1" : "0");
    window.localStorage.setItem(
      `editor:page-meta:${docId}`,
      JSON.stringify({
        zoomLevel,
        headerText,
        footerText,
        showPageNumbers,
      }),
    );
  }, [docId, footerText, headerText, isFocusMode, layout, showPageNumbers, wordGoal, zoomLevel]);

  useEffect(() => {
    findQueryRef.current = findQuery;
    findCaseSensitiveRef.current = findCaseSensitive;
    findWholeWordRef.current = findWholeWord;
    findInSelectionRef.current = findInSelection;
    findSelectionWindowRef.current = findSelectionWindow;
  }, [findCaseSensitive, findInSelection, findQuery, findSelectionWindow, findWholeWord]);

  useEffect(() => {
    if (!isFocusMode) return;
    setIsExportMenuOpen(false);
    setOpenToolbarMenu(null);
  }, [isFocusMode]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("[data-export-menu]") && !target.closest("[data-export-floating]")) setIsExportMenuOpen(false);
      if (!target.closest("[data-toolbar-menu]") && !target.closest("[data-toolbar-floating]")) setOpenToolbarMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsExportMenuOpen(false);
      setOpenToolbarMenu(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const now = Date.now();
    const last = lastToastRef.current;
    if (last && last.text === message && now - last.at < 10_000) return;
    lastToastRef.current = { text: message, at: now };
    const timer = window.setTimeout(() => {
      setMessage((current) => (current === message ? "" : current));
    }, 4_500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [message]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;

    const syncApiAvailability = async () => {
      const ctx = readApiCtx();
      const available = await probeApiAvailability(ctx);
      if (active) setApiAvailable(available);
    };

    void syncApiAvailability();
    const onFocus = () => {
      void syncApiAvailability();
    };
    const onStorage = () => {
      void syncApiAvailability();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const refreshDocumentList = useCallback(async () => {
    const local = readLocalDocumentIndex().map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status || "DRAFT",
      updatedAt: item.updatedAt || new Date(0).toISOString(),
      source: "local" as const,
    }));
    setLocalDocuments(local);

    if (!apiAvailable) {
      setRemoteDocuments([]);
      return;
    }

    const list = await apiRequest<Array<{
      id: string;
      title: string;
      status: DocStatus;
      updatedAt: string;
    }>>("/documents?limit=40").catch(() => null);

    if (!list) {
      setRemoteDocuments([]);
      return;
    }

    setRemoteDocuments(
      list.map((item) => ({
        id: item.id,
        title: item.title || fallbackDocumentTitle(item.id),
        status: item.status || "DRAFT",
        updatedAt: item.updatedAt || new Date(0).toISOString(),
        source: "remote" as const,
      })),
    );
  }, [apiAvailable]);

  useEffect(() => {
    void refreshDocumentList();
  }, [docId, refreshDocumentList]);

  useEffect(() => {
    const remoteMatch = remoteDocuments.find((item) => item.id === docId);
    const localMatch = localDocuments.find((item) => item.id === docId);
    const nextStatus = remoteMatch?.status || localMatch?.status || "DRAFT";
    setStatus(nextStatus);
  }, [docId, localDocuments, remoteDocuments]);

  useEffect(() => {
    if (localDocuments.some((item) => item.id === docId)) return;
    syncLocalDocument({
      id: docId,
      title: fallbackDocumentTitle(docId),
      status,
      updatedAt: new Date().toISOString(),
    });
  }, [docId, localDocuments, status, syncLocalDocument]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit, TextStyle, FontSize, BlockLayout, OrderedListStyle, FontFamily.configure({ types: ["textStyle"] }), Color, Highlight.configure({ multicolor: true }),
      Underline, Subscript, Superscript, TaskList, TaskItem.configure({ nested: true }), Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, Image.configure({ allowBase64: true }),
      LinkExtension.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }), TextAlign.configure({ types: ["heading", "paragraph"] }), CharacterCount,
      Placeholder.configure({ placeholder: "Belge metnini yazin veya @ ile kanun maddesi ekleyin..." }), Footnote, LawMention, DynamicField,
    ],
    content: initialContent ?? INITIAL_CONTENT,
    editorProps: {
      attributes: { class: "focus:outline-none max-w-none text-slate-900", style: "font-family:'Times New Roman',serif;" },
      handleKeyDown: (_view, event) => {
        const current = mentionRef.current;
        if (current) {
          if (event.key === "ArrowDown") { event.preventDefault(); updateMention({ ...current, selected: (current.selected + 1) % current.items.length }); return true; }
          if (event.key === "ArrowUp") { event.preventDefault(); updateMention({ ...current, selected: (current.selected + current.items.length - 1) % current.items.length }); return true; }
          if (event.key === "Escape") { event.preventDefault(); updateMention(null); return true; }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const item = current.items[current.selected];
            editor?.chain().focus().insertContentAt({ from: current.from, to: current.to }, { type: "lawMention", attrs: item }).insertContent(" ").run();
            updateMention(null);
            return true;
          }
        }

        if (event.key === "Tab") {
          const handled = event.shiftKey
            ? (editor?.chain().focus().liftListItem("listItem").run() || editor?.chain().focus().liftListItem("taskItem").run())
            : (editor?.chain().focus().sinkListItem("listItem").run() || editor?.chain().focus().sinkListItem("taskItem").run());
          if (handled) {
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const clipboardData = event.clipboardData;
        if (clipboardData && editor) {
          const internalPaste = pasteInternalUdfFragment(editor, clipboardData);
          if (internalPaste.handled) {
            const modeLabel =
              internalPaste.mode === "custom"
                ? "UDF iç yapıştırma"
                : internalPaste.mode === "html"
                  ? "HTML fallback yapıştırma"
                  : "text fallback yapıştırma";
            const firstWarning = internalPaste.warnings[0];
            setMessage(
              firstWarning
                ? `${modeLabel} uygulandi. ${firstWarning}`
                : `${modeLabel} uygulandi.`,
            );
            event.preventDefault();
            return true;
          }
        }

        const items = Array.from(clipboardData?.items ?? []);
        const imageItem = items.find((item) => item.type.startsWith("image/"));
        if (!imageItem) return false;
        const file = imageItem.getAsFile();
        if (!file) return false;
        window.dispatchEvent(new CustomEvent("editor:insert-image-file", { detail: { file } }));
        event.preventDefault();
        return true;
      },
      handleClick: (view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const mentionElement = target?.closest("span[data-law-mention]") as HTMLElement | null;
        if (!mentionElement) {
          setMentionPreview(null);
          return false;
        }
        const id = mentionElement.getAttribute("data-law-id") || "";
        const label = mentionElement.getAttribute("data-law-label") || mentionElement.textContent?.replace(/^@/, "") || id;
        const text = mentionElement.getAttribute("data-law-text") || "";
        const rect = mentionElement.getBoundingClientRect();
        const coords = view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
        setMentionPreview({
          id,
          label,
          text,
          pos: coords?.pos ?? view.state.selection.from,
          top: rect.bottom + 8,
          left: rect.left,
        });
        return false;
      },
      handleDOMEvents: {
        mouseover: (view, event) => {
          const target = event.target as HTMLElement | null;
          const mentionElement = target?.closest("span[data-law-mention]") as HTMLElement | null;
          if (!mentionElement) return false;
          const id = mentionElement.getAttribute("data-law-id") || "";
          const label = mentionElement.getAttribute("data-law-label") || mentionElement.textContent?.replace(/^@/, "") || id;
          const text = mentionElement.getAttribute("data-law-text") || "";
          const rect = mentionElement.getBoundingClientRect();
          const coords = view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
          setMentionPreview({
            id,
            label,
            text,
            pos: coords?.pos ?? view.state.selection.from,
            top: rect.bottom + 8,
            left: rect.left,
          });
          return false;
        },
        mouseout: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const next = (event.relatedTarget as HTMLElement | null) ?? null;
          const leavingMention = target?.closest("span[data-law-mention]");
          const enteringMention = next?.closest("span[data-law-mention]");
          const enteringPreview = next?.closest("[data-mention-preview]");
          if (leavingMention && !enteringMention && !enteringPreview) {
            setMentionPreview(null);
          }
          return false;
        },
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const dt = event.dataTransfer;
        if (!dt) return false;
        const imageFile = Array.from(dt.files ?? []).find((file) => file.type.startsWith("image/"));
        if (imageFile) {
          window.dispatchEvent(new CustomEvent("editor:insert-image-file", { detail: { file: imageFile } }));
          event.preventDefault();
          return true;
        }
        const raw = dt.getData("application/x-jurix-snippet") || dt.getData("text/plain");
        if (!raw) return false;
        let title = "Alinti"; let content = raw;
        try {
          if (raw.startsWith("{")) { const parsed = JSON.parse(raw) as { title?: string; content?: string }; title = parsed.title || title; content = parsed.content || ""; }
          else if (raw.includes("\n")) { const [h, ...rest] = raw.split("\n"); title = h || title; content = rest.join("\n"); }
        } catch { /* noop */ }
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        window.dispatchEvent(new CustomEvent("jurix:drop-text", { detail: { title, content, pos } }));
        event.preventDefault();
        return true;
      },
    },
  });

  const buildCanonicalTree = useCallback(() => {
    if (!editor) return null;
    return {
      type: "tiptap_doc",
      schemaVersion: 1,
      content: withEditorMeta(
        editor.getJSON() as JSONContent,
        canonicalPageMeta,
        canonicalComments,
        canonicalNotes,
      ),
    };
  }, [canonicalComments, canonicalNotes, canonicalPageMeta, editor]);

  const applyEditorContent = useCallback((contentCandidate: unknown): boolean => {
    if (!editor) return false;
    const content = stripEditorMetaFromContent(contentCandidate);
    if (!content) return false;
    const pageMeta = extractPageMetaFromContent(contentCandidate);
    if (pageMeta) {
      setHeaderText(pageMeta.headerText);
      setFooterText(pageMeta.footerText);
      setShowPageNumbers(pageMeta.showPageNumbers);
    } else {
      setHeaderText("");
      setFooterText("");
      setShowPageNumbers(false);
    }
    setDocumentComments(extractDocumentCommentsFromContent(contentCandidate));
    setDocumentNotes(extractDocumentNotesFromContent(contentCandidate));
    editor.commands.setContent(content);
    return true;
  }, [editor]);

  const insertImageFile = useCallback((file: File) => {
    if (!editor) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Sadece gorsel dosyasi desteklenir.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage("Gorsel boyutu 8MB sinirini asiyor.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) return;
      editor.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    onReady?.(editor);
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor) return;

    const refreshComputedState = () => {
      const count =
        (editor.storage.characterCount as { words?: () => number })?.words?.() ??
        editor.getText().trim().split(/\s+/).filter(Boolean).length;
      setWordCount(count);
      updateMention(mentionUi(editor, mentionSource));
      setOutlineItems(collectOutlineItems(editor));
      const liveFindQuery = findQueryRef.current;
      if (liveFindQuery.trim()) {
        const nextMatches = collectFindMatches(editor, liveFindQuery, {
          caseSensitive: findCaseSensitiveRef.current,
          wholeWord: findWholeWordRef.current,
          selectionWindow: findInSelectionRef.current ? findSelectionWindowRef.current : null,
        });
        setFindMatches(nextMatches);
        setActiveFindMatch((prev) => {
          if (!nextMatches.length) return -1;
          if (prev < 0) return 0;
          return Math.min(prev, nextMatches.length - 1);
        });
      } else {
        setFindMatches([]);
        setActiveFindMatch(-1);
      }
    };

    const handleUpdate = () => {
      refreshComputedState();
      if (!readOnly && mode === "edit" && status !== "FINAL" && status !== "ARCHIVED") {
        if (autosaveRef.current) window.clearTimeout(autosaveRef.current);
        autosaveRef.current = window.setTimeout(async () => {
          setSaveState("saving");
          const nowIso = new Date().toISOString();
          const canonical = buildCanonicalTree();
          if (!canonical) return;
          const currentTitle = deriveDocumentTitle(editor.getText(), docId);
          const saved = await apiRequest(`/documents/${docId}/autosave`, {
            method: "POST",
            body: JSON.stringify({
              schemaVersion: 1,
              canonicalJson: canonical,
              recoveredFromCrash: false,
            }),
          }).catch(() => null);
          if (saved) {
            window.localStorage.removeItem(draftKey);
            setSaveState("saved");
            syncLocalDocument({
              id: docId,
              title: currentTitle,
              status,
              updatedAt: nowIso,
            });
          } else {
            window.localStorage.setItem(
              draftKey,
              JSON.stringify({ canonical, updatedAt: nowIso }),
            );
            setSaveState(apiAvailable ? "error" : "offline");
            syncLocalDocument({
              id: docId,
              title: currentTitle,
              status,
              updatedAt: nowIso,
            });
          }
        }, 1200);
      }
      onChange?.({
        json: editor.getJSON() as JSONContent,
        html: editor.getHTML(),
        text: editor.getText(),
      });
    };

    const handleSelectionUpdate = () => {
      updateMention(mentionUi(editor, mentionSource));
    };

    refreshComputedState();
    onChange?.({
      json: editor.getJSON() as JSONContent,
      html: editor.getHTML(),
      text: editor.getText(),
    });
    editor.on("update", handleUpdate);
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      if (autosaveRef.current) {
        window.clearTimeout(autosaveRef.current);
        autosaveRef.current = null;
      }
      editor.off("update", handleUpdate);
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [apiAvailable, buildCanonicalTree, collectFindMatches, collectOutlineItems, docId, draftKey, editor, mentionSource, mode, onChange, readOnly, status, syncLocalDocument, updateMention]);

  useEffect(() => {
    if (!editor) return;
    if (!findQuery.trim()) {
      setFindMatches([]);
      setActiveFindMatch(-1);
      return;
    }
    const nextMatches = collectFindMatches(editor, findQuery, {
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
      selectionWindow: findInSelection ? findSelectionWindow : null,
    });
    setFindMatches(nextMatches);
    setActiveFindMatch((prev) => {
      if (!nextMatches.length) return -1;
      if (prev < 0) return 0;
      return Math.min(prev, nextMatches.length - 1);
    });
  }, [collectFindMatches, editor, findCaseSensitive, findInSelection, findQuery, findSelectionWindow, findWholeWord]);

  useEffect(() => {
    return () => {
      if (autosaveRef.current) {
        window.clearTimeout(autosaveRef.current);
        autosaveRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!editor || hydratedDraftRef.current) return;
    hydratedDraftRef.current = true;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { canonical?: { content?: JSONContent } };
      if (!parsed.canonical?.content) return;
      const hasRealContent = editor.getText().trim() && editor.getText().trim() !== "Belge metnini yazin...";
      if (hasRealContent) return;
      if (!applyEditorContent(parsed.canonical.content)) return;
      setMessage("Yerel draft geri yuklendi.");
    } catch {
      // ignore malformed draft payload
    }
  }, [applyEditorContent, draftKey, editor]);

  const insertSnippet = useCallback((title: string, content: string, pos?: number) => {
    if (!editor) return;
    let chain = editor.chain().focus();
    if (typeof pos === "number") chain = chain.setTextSelection(pos);
    chain.insertContent(snippetHtml(title, content)).run();
  }, [editor]);

  const setLinkFromPrompt = useCallback(() => {
    if (!editor) return;
    const rawHref = window.prompt("URL", "https://");
    if (rawHref === null) return;
    const href = normalizeEditorLinkHref(rawHref);
    if (!href) {
      setMessage("Gecersiz veya guvensiz baglanti adresi.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }, [editor]);

  useEffect(() => {
    if (!editor || !enableLegacyEvents) return;
    const handler = (event: Event) => {
      const e = event as CustomEvent<{ title?: string; content?: string; pos?: number }>;
      insertSnippet(e.detail?.title || "Alinti", e.detail?.content || "", e.detail?.pos);
    };
    window.addEventListener("jurix:insert-text", handler);
    window.addEventListener("jurix:drop-text", handler);
    return () => { window.removeEventListener("jurix:insert-text", handler); window.removeEventListener("jurix:drop-text", handler); };
  }, [editor, enableLegacyEvents, insertSnippet]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ file?: File }>;
      const file = custom.detail?.file;
      if (!file) return;
      insertImageFile(file);
    };
    window.addEventListener("editor:insert-image-file", handler);
    return () => {
      window.removeEventListener("editor:insert-image-file", handler);
    };
  }, [insertImageFile]);

  useEffect(() => {
    const currentQuery = mention?.query?.trim();
    if (!currentQuery || currentQuery.length < 2) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/legal-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: currentQuery }),
        });
        if (!response.ok) return;
        const payload = await response.json() as { results?: Array<{ id?: string; title?: string; content?: string }> };
        const next = (payload.results ?? [])
          .map((item, index) => ({
            id: item.id || `${item.title || "law"}-${index}`,
            label: item.title || `Madde ${index + 1}`,
            text: item.content || "",
          }))
          .filter((item) => item.text);
        if (next.length) setRemoteMentionItems((prev) => [...prev, ...next.filter((item) => !prev.find((x) => x.id === item.id))]);
      } catch {
        // keep fallback mention list
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [mention?.query]);

  useEffect(() => {
    if (!mentionPreview) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-mention-preview]")) return;
      if (target?.closest("span[data-law-mention]")) return;
      setMentionPreview(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMentionPreview(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mentionPreview]);

  useEffect(() => {
    if (layout !== "full") return;
    if (!apiAvailable) {
      setTemplates(LOCAL_TEMPLATES);
      setClauses(LOCAL_CLAUSES);
      setExports([]);
      setLinks([]);
      setVersions([]);
      return;
    }
    void Promise.all([
      apiRequest<TemplateItem[]>("/templates").then((v) => v && setTemplates(v)).catch(() => null),
      apiRequest<ClauseItem[]>("/clauses").then((v) => v && setClauses(v)).catch(() => null),
      apiRequest<ExportItem[]>(`/documents/${docId}/exports`).then((v) => v && setExports(v)).catch(() => null),
      apiRequest<ShareLinkItem[]>(`/documents/${docId}/share-links`).then((v) => v && setLinks(v)).catch(() => null),
      apiRequest<DocumentVersionItem[]>(`/documents/${docId}/versions`).then((v) => v && setVersions(v)).catch(() => null),
    ]);
  }, [apiAvailable, docId, layout]);

  useEffect(() => {
    if (layout !== "full") {
      setHasWriteLease(true);
      return;
    }
    if (!apiAvailable) {
      setHasWriteLease(true);
      setSaveState("offline");
      setMessage("Yerel duzenleme modu aktif: kilit, export ve paylasim API baglantisi olmadan sinirli calisir.");
      return;
    }
    let active = true;
    setHasWriteLease(false);

    const acquire = async () => {
      const lock = await apiRequest<LockSnapshot>(`/documents/${docId}/locks/acquire`, {
        method: "POST",
        body: JSON.stringify({ leaseSeconds: 120 }),
      }).catch(() => null);
      if (!active) return;
      if (!lock) {
        setHasWriteLease(false);
        setCurrentLock(null);
        setMode("preview");
        setMessage("Yazma kilidi alinamadi. Belge onizleme modunda acildi.");
        return;
      }
      setHasWriteLease(true);
      setCurrentLock(lock);
      setMessage("");
      lockRefreshRef.current = window.setInterval(() => {
        void apiRequest<LockSnapshot>(`/documents/${docId}/locks/refresh`, {
          method: "POST",
          body: JSON.stringify({ leaseSeconds: 120 }),
        }).then((nextLock) => {
          if (nextLock) {
            setCurrentLock(nextLock);
          }
        }).catch(() => {
          if (lockRefreshRef.current) {
            window.clearInterval(lockRefreshRef.current);
            lockRefreshRef.current = null;
          }
          setHasWriteLease(false);
          setCurrentLock(null);
          setMode("preview");
          setMessage("Yazma kilidi yenilenemedi. Onizleme moduna gecildi.");
        });
      }, 90_000);
    };

    void acquire();
    return () => {
      active = false;
      if (lockRefreshRef.current) {
        window.clearInterval(lockRefreshRef.current);
        lockRefreshRef.current = null;
      }
      setCurrentLock(null);
      void apiRequest(`/documents/${docId}/locks/release`, {
        method: "POST",
        body: JSON.stringify({}),
      }).catch(() => null);
    };
  }, [apiAvailable, docId, layout]);

  useEffect(() => {
    if (!apiAvailable || layout !== "full") {
      setCurrentLock(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      const lock = await apiRequest<LockSnapshot | null>(
        `/documents/${docId}/locks/current`,
      ).catch(() => null);
      if (!alive) return;
      setCurrentLock(lock);
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [apiAvailable, docId, layout]);

  useEffect(() => {
    if (typeof window === "undefined" || layout !== "full") {
      return;
    }
    const channel = new BroadcastChannel(`editor-presence:${docId}`);
    presenceChannelRef.current = channel;
    const emitPresence = () => {
      channel.postMessage({
        type: "presence",
        id: sessionIdRef.current,
        mode,
        at: Date.now(),
      });
    };
    emitPresence();
    const heartbeat = window.setInterval(emitPresence, 10_000);
    const prune = window.setInterval(() => {
      const limit = Date.now() - 30_000;
      setPeerSessions((prev) => prev.filter((item) => item.updatedAt >= limit));
    }, 5_000);

    channel.onmessage = (event) => {
      const payload = event.data as {
        type?: string;
        id?: string;
        at?: number;
        mode?: "edit" | "preview";
      };
      const payloadId = payload.id;
      const payloadAt = payload.at;
      if (payload.type !== "presence" || !payloadId || !payloadAt) {
        return;
      }
      if (payloadId === sessionIdRef.current) {
        return;
      }
      setPeerSessions((prev) => {
        const without = prev.filter((item) => item.id !== payloadId);
        return [
          ...without,
          {
            id: payloadId,
            updatedAt: payloadAt,
            mode: payload.mode === "preview" ? "preview" : "edit",
          },
        ];
      });
    };

    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(prune);
      channel.close();
      presenceChannelRef.current = null;
      setPeerSessions([]);
    };
  }, [docId, layout, mode]);

  useEffect(() => {
    if (!suggestionMode) return;
    setMessage("Oneri modu acik: degisiklikleri suggestion paneline not etmeyi unutmayin.");
  }, [suggestionMode]);

  const syncCanonicalBeforePreviewOrExport = useCallback(async () => {
    if (!apiAvailable || !editor) return;
    if (status === "FINAL" || status === "ARCHIVED") return;
    const canonical = buildCanonicalTree();
    if (!canonical) return;
    await apiRequest(`/documents/${docId}/autosave`, {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: 1,
        canonicalJson: canonical,
        recoveredFromCrash: false,
      }),
    }).catch(() => null);
  }, [apiAvailable, buildCanonicalTree, docId, editor, status]);

  useEffect(() => {
    if (layout !== "full" || mode !== "preview") return;
    let active = true;
    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        if (!readOnly) {
          await syncCanonicalBeforePreviewOrExport();
        }
        const response = await apiRequest<{ html: string }>(`/documents/${docId}/print-preview`).catch(() => null);
        if (!active) return;
        setPreviewHtml(response?.html ?? `<!doctype html><html><body>${editor?.getHTML() || ""}</body></html>`);
      } finally {
        if (active) {
          setPreviewLoading(false);
        }
      }
    };
    void loadPreview();
    return () => {
      active = false;
    };
  }, [docId, editor, layout, mode, readOnly, syncCanonicalBeforePreviewOrExport]);

  const refreshExports = useCallback(async () => {
    if (!apiAvailable) {
      setExports([]);
      return;
    }
    const list = await apiRequest<ExportItem[]>(`/documents/${docId}/exports`).catch(() => null);
    if (list) setExports(list);
  }, [apiAvailable, docId]);

  const requestExport = useCallback(async (format: "pdf" | "docx") => {
    if (requestingExportFormat) return;
    setRequestingExportFormat(format);
    try {
      if (!apiAvailable) {
        if (format === "docx") {
          if (!editor) return;
          const html = `<!doctype html><html><head><meta charset=\"utf-8\"/></head><body>${editor.getHTML()}</body></html>`;
          downloadBlob(`belge-${docId}.doc`, new Blob([html], { type: "application/msword;charset=utf-8" }));
          setMessage("Yerel DOCX cikti olusturuldu.");
        } else {
          setMode("preview");
          setMessage("PDF export API baglantisi olmadan kullanilamiyor. Tarayicidan yazdir secenegini kullanin.");
        }
        return;
      }
      if (!readOnly) {
        await syncCanonicalBeforePreviewOrExport();
      }
      const endpoint = format === "pdf" ? "pdf" : "docx";
      const requested = await apiRequest(`/documents/${docId}/exports/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({}),
      }).catch(() => {
        setMessage("Export istegi basarisiz.");
        return null;
      });
      if (!requested) {
        setMessage("Export API yanit vermedi.");
        return;
      }
      await refreshExports();
    } finally {
      setRequestingExportFormat(null);
    }
  }, [apiAvailable, docId, editor, readOnly, refreshExports, requestingExportFormat, syncCanonicalBeforePreviewOrExport]);

  const refreshLinks = useCallback(async () => {
    if (!apiAvailable) {
      setLinks([]);
      return;
    }
    const list = await apiRequest<ShareLinkItem[]>(`/documents/${docId}/share-links`).catch(() => null);
    if (list) setLinks(list);
  }, [apiAvailable, docId]);

  const createShareLink = useCallback(async () => {
    if (creatingShareLink) return;
    setCreatingShareLink(true);
    try {
      if (!apiAvailable) {
        setNewLink(`${window.location.origin}/editor/${docId}`);
        setMessage("Yerel modda genel paylasim linki uretilmez. Sadece sayfa adresi olusturuldu.");
        return;
      }
      const created = await apiRequest<{ publicUrl?: string }>(`/documents/${docId}/share-links`, {
        method: "POST",
        body: JSON.stringify({ permission, expiresInHours: 72 }),
      }).catch(() => null);
      if (!created?.publicUrl) {
        setMessage("Paylasim linki olusturulamadi.");
        return;
      }
      setNewLink(created.publicUrl);
      await refreshLinks();
    } finally {
      setCreatingShareLink(false);
    }
  }, [apiAvailable, creatingShareLink, docId, permission, refreshLinks]);

  const copyShareLink = useCallback(async () => {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink);
      setMessage("Paylasim linki kopyalandi.");
    } catch {
      setMessage("Paylasim linki kopyalanamadi; manuel olarak secip kopyalayin.");
    }
  }, [newLink]);

  const refreshVersions = useCallback(async () => {
    if (!apiAvailable) {
      setVersions([]);
      return;
    }
    const list = await apiRequest<DocumentVersionItem[]>(
      `/documents/${docId}/versions`,
    ).catch(() => null);
    if (list) {
      setVersions(list);
    }
  }, [apiAvailable, docId]);

  const downloadExport = useCallback(
    async (exportId: string) => {
      if (!apiAvailable) {
        setMessage("Yerel modda kuyruk export indirme kullanilamaz.");
        return;
      }
      setDownloadingExportId(exportId);
      try {
        const signed = await apiRequest<{ signedUrl?: string }>(
          `/documents/${docId}/exports/${exportId}/signed-url`,
        ).catch(() => null);
        if (!signed?.signedUrl) {
          setMessage("Export indirme linki olusturulamadi.");
          return;
        }
        window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
        await apiRequest(`/documents/${docId}/exports/${exportId}/downloaded`, {
          method: "POST",
          body: JSON.stringify({}),
        }).catch(() => null);
        setMessage("Export indirme baslatildi.");
      } finally {
        setDownloadingExportId(null);
      }
    },
    [apiAvailable, docId],
  );

  const revokeShareLink = useCallback(
    async (shareLinkId: string) => {
      if (!apiAvailable) {
        setLinks((prev) => prev.filter((item) => item.id !== shareLinkId));
        setMessage("Yerel modda paylasim kaydi sadece listeden kaldirildi.");
        return;
      }
      setRevokingShareId(shareLinkId);
      try {
        await apiRequest(`/documents/${docId}/share-links/${shareLinkId}/revoke`, {
          method: "POST",
          body: JSON.stringify({}),
        }).catch(() => null);
        await refreshLinks();
      } finally {
        setRevokingShareId(null);
      }
    },
    [apiAvailable, docId, refreshLinks],
  );

  const updateDocumentStatus = useCallback(
    async (nextStatus: DocStatus) => {
      if (nextStatus === status) return;
      const allowed = DOC_STATUS_TRANSITIONS[status] || [];
      if (!allowed.includes(nextStatus)) {
        setMessage(`Durum gecisi gecersiz: ${status} -> ${nextStatus}`);
        return;
      }
      if (!apiAvailable) {
        setStatus(nextStatus);
        syncLocalDocument({
          id: docId,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        });
        setMessage(`Yerel modda durum ${nextStatus} olarak guncellendi.`);
        return;
      }
      const updated = await apiRequest<{ status?: DocStatus }>(
        `/documents/${docId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
      ).catch(() => null);
      if (!updated?.status) {
        setMessage("Durum guncellenemedi.");
        return;
      }
      setStatus(updated.status);
      syncLocalDocument({
        id: docId,
        status: updated.status,
        updatedAt: new Date().toISOString(),
      });
      setMessage(`Durum ${updated.status} olarak guncellendi.`);
    },
    [apiAvailable, docId, status, syncLocalDocument],
  );

  const finalizeDocument = useCallback(async () => {
    if (status === "FINAL") return;
    if (!apiAvailable) {
      setStatus("FINAL");
      syncLocalDocument({
        id: docId,
        status: "FINAL",
        updatedAt: new Date().toISOString(),
      });
      setMode("preview");
      setMessage("Yerel modda belge final olarak isaretlendi.");
      return;
    }
    const finalized = await apiRequest<{ status?: DocStatus }>(
      `/documents/${docId}/finalize`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ).catch(() => null);
    if (!finalized?.status) {
      setMessage("Belge finalize edilemedi.");
      return;
    }
    setStatus(finalized.status);
    setMode("preview");
    syncLocalDocument({
      id: docId,
      status: finalized.status,
      updatedAt: new Date().toISOString(),
    });
    await refreshVersions();
    setMessage("Belge finalize edildi.");
  }, [apiAvailable, docId, refreshVersions, status, syncLocalDocument]);

  const restoreVersion = useCallback(
    async (version: DocumentVersionItem) => {
      if (status === "FINAL" || status === "ARCHIVED") {
        setMessage("Final/Arsiv belgede geri yukleme icin once Draft kopyasi olusturun.");
        return;
      }
      if (!apiAvailable) {
        setMessage("Versiyon geri yukleme yalnizca sunucu modunda kullanilabilir.");
        return;
      }
      setRestoringVersionId(version.id);
      try {
        const restored = await apiRequest<{
          status?: DocStatus;
          latestVersion?: number;
          updatedAt?: string;
        }>(`/documents/${docId}/versions/${version.id}/restore`, {
          method: "POST",
          body: JSON.stringify({}),
        }).catch(() => null);
        if (!restored) {
          setMessage("Versiyon geri yuklenemedi.");
          return;
        }
        if (editor) {
          const snapshot = await apiRequest<{
            canonicalJson?: Record<string, unknown>;
            schemaVersion?: number;
          }>(`/documents/${docId}/versions/${version.id}`).catch(() => null);
          const contentCandidate = resolveCanonicalContent(snapshot?.canonicalJson);
          if (contentCandidate) {
            applyEditorContent(contentCandidate);
          }
        }
        await refreshVersions();
        await refreshDocumentList();
        setSaveState("saved");
        setMessage(`v${version.versionNumber} surumu geri yuklendi.`);
      } finally {
        setRestoringVersionId(null);
      }
    },
    [apiAvailable, applyEditorContent, docId, editor, refreshDocumentList, refreshVersions, status],
  );

  const forkDraft = useCallback(async () => {
    if (!apiAvailable) {
      const localId = `local-${Date.now().toString(36)}`;
      const nowIso = new Date().toISOString();
      const canonical = buildCanonicalTree();
      if (canonical && typeof window !== "undefined") {
        window.localStorage.setItem(
          `editor-unified:draft:${localId}`,
          JSON.stringify({
            canonical,
            updatedAt: nowIso,
          }),
        );
      }
      window.location.assign(`/editor/${localId}`);
      return;
    }
    const next = await apiRequest<{ id?: string }>(`/documents/${docId}/fork-draft`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!next?.id) {
      setMessage("Yeni draft olusturulamadi.");
      return;
    }
    window.location.assign(`/editor/${next.id}`);
  }, [apiAvailable, buildCanonicalTree, docId]);

  const applyTemplate = useCallback(
    (template: TemplateItem) => {
      if (!editor) return;
      const content = extractTemplateContent(template);
      if (!content) {
        setMessage("Template icerigi okunamadi.");
        return;
      }
      if (!applyEditorContent(content)) {
        setMessage("Template icerigi gecersiz.");
        return;
      }
      setMessage(`Template uygulandi: ${template.name}`);
    },
    [applyEditorContent, editor],
  );

  const insertClause = useCallback(
    (clause: ClauseItem) => {
      if (!editor) return;
      const candidate = clause.bodyJson;
      if (candidate && typeof candidate === "object") {
        editor.chain().focus().insertContent(candidate as JSONContent).run();
        setMessage(`Clause eklendi: ${clause.title}`);
        return;
      }
      insertSnippet(clause.title, String(candidate || ""));
    },
    [editor, insertSnippet],
  );

  const insertDynamicField = useCallback(
    (field: (typeof LOCAL_DYNAMIC_FIELDS)[number]) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertDynamicField({
          fieldKey: field.fieldKey,
          label: field.label,
          value: field.defaultValue || "",
        })
        .run();
      setMessage(`Dinamik alan eklendi: ${field.label}`);
    },
    [editor],
  );

  const insertLegalBlock = useCallback(
    (blockId: (typeof LEGAL_BLOCKS)[number]["id"]) => {
      if (!editor) return;
      const nodes = buildLegalBlockContent(blockId);
      editor.chain().focus().insertContent(nodes).run();
      const target = LEGAL_BLOCKS.find((item) => item.id === blockId);
      setMessage(`Hukuki blok eklendi: ${target?.label || blockId}`);
    },
    [editor],
  );

  const indentListItem = useCallback(() => {
    if (!editor) return;
    const handled =
      editor.chain().focus().sinkListItem("listItem").run() ||
      editor.chain().focus().sinkListItem("taskItem").run();
    if (!handled) {
      setMessage("Girinti artirmak icin bir liste satiri secin.");
    }
  }, [editor]);

  const outdentListItem = useCallback(() => {
    if (!editor) return;
    const handled =
      editor.chain().focus().liftListItem("listItem").run() ||
      editor.chain().focus().liftListItem("taskItem").run();
    if (!handled) {
      setMessage("Girinti azaltmak icin bir alt liste satiri secin.");
    }
  }, [editor]);

  const updateActiveBlockAttributes = useCallback(
    (nextAttrs: Record<string, string | null>) => {
      if (!editor) return;
      if (editor.isActive("heading")) {
        editor.chain().focus().updateAttributes("heading", nextAttrs).run();
        return;
      }
      editor.chain().focus().updateAttributes("paragraph", nextAttrs).run();
    },
    [editor],
  );

  const setLineSpacing = useCallback(
    (lineHeight: string) => {
      updateActiveBlockAttributes({ lineHeight });
    },
    [updateActiveBlockAttributes],
  );

  const adjustParagraphSpacing = useCallback(
    (delta: number) => {
      if (!editor) return;
      const source = editor.isActive("heading")
        ? editor.getAttributes("heading")
        : editor.getAttributes("paragraph");
      const current = parseCssPixel(source.marginBottom, 0);
      const next = clampNumber(current + delta, 0, 96);
      updateActiveBlockAttributes({ marginBottom: next === 0 ? null : `${next}px` });
    },
    [editor, updateActiveBlockAttributes],
  );

  const adjustParagraphIndent = useCallback(
    (delta: number) => {
      if (!editor) return;
      const source = editor.isActive("heading")
        ? editor.getAttributes("heading")
        : editor.getAttributes("paragraph");
      const current = parseCssPixel(source.marginLeft, 0);
      const next = clampNumber(current + delta, 0, 120);
      updateActiveBlockAttributes({ marginLeft: next === 0 ? null : `${next}px` });
    },
    [editor, updateActiveBlockAttributes],
  );

  const applyLegalStylePreset = useCallback(
    (presetId: LegalStylePresetId) => {
      if (!editor) return;
      const preset = getLegalStylePresetById(presetId);
      if (!preset) return;
      const blockAttrs = {
        lineHeight: preset.lineHeight,
        marginBottom: preset.paragraphSpacingPx > 0 ? `${preset.paragraphSpacingPx}px` : null,
        marginLeft: preset.paragraphIndentPx > 0 ? `${preset.paragraphIndentPx}px` : null,
      } as const;

      editor
        .chain()
        .focus()
        .setFontFamily(preset.fontFamily)
        .setMark("textStyle", { fontSize: preset.fontSize })
        .setTextAlign(preset.textAlign)
        .updateAttributes("paragraph", blockAttrs)
        .updateAttributes("heading", blockAttrs)
        .run();
      setMessage(`${preset.label} stili uygulandi.`);
    },
    [editor],
  );

  const insertFootnoteFromPrompt = useCallback(() => {
    if (!editor) return;
    const note = window.prompt("Dipnot");
    if (!note?.trim()) return;
    editor.chain().focus().insertFootnote(note.trim()).run();
    setMessage("Dipnot eklendi.");
  }, [editor]);

  const focusOutlineItem = useCallback(
    (item: OutlineItem) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(item.pos).scrollIntoView().run();
      setOpenToolbarMenu(null);
    },
    [editor],
  );

  const insertTableOfContents = useCallback(() => {
    if (!editor) return;
    const tocContent = buildTableOfContentsContent(
      outlineItems.map((item) => ({ level: item.level, text: item.text })),
    );
    editor.chain().focus().insertContent(tocContent).run();
    setMessage(
      outlineItems.length
        ? `${outlineItems.length} basliktan icindekiler eklendi.`
        : "Belgede baslik olmadigi icin yonlendirme metni eklendi.",
    );
    setOpenToolbarMenu(null);
  }, [editor, outlineItems]);

  const refreshTableOfContents = useCallback(() => {
    if (!editor) return;

    const rootContent = Array.isArray(editor.getJSON().content)
      ? (editor.getJSON().content as JSONContent[])
      : [];
    const range = findTableOfContentsRange(rootContent);
    if (!range) {
      setMessage("Guncellenecek icindekiler bulunamadi. Once 'Icindekiler Ekle' kullanin.");
      return;
    }

    const tocContent = buildTableOfContentsContent(
      outlineItems.map((item) => ({ level: item.level, text: item.text })),
    );

    const startIndex = clampNumber(range.startIndex, 0, Math.max(0, editor.state.doc.childCount - 1));
    const endIndex = clampNumber(range.endIndex, startIndex, Math.max(startIndex, editor.state.doc.childCount - 1));

    let from = 1;
    for (let i = 0; i < startIndex; i += 1) {
      from += editor.state.doc.child(i).nodeSize;
    }
    let to = from;
    for (let i = startIndex; i <= endIndex; i += 1) {
      to += editor.state.doc.child(i).nodeSize;
    }

    try {
      const replacement = tocContent.map((node) => editor.state.schema.nodeFromJSON(node as Record<string, unknown>));
      const transaction = editor.state.tr.replaceWith(from, to, replacement);
      editor.view.dispatch(transaction.scrollIntoView());
      setMessage(
        outlineItems.length
          ? `${outlineItems.length} baslikla icindekiler guncellendi.`
          : "Icindekiler baslik bulunmadigi icin yonlendirme metniyle guncellendi.",
      );
      setOpenToolbarMenu(null);
    } catch {
      setMessage("Icindekiler guncellenirken bir hata olustu.");
    }
  }, [editor, outlineItems]);

  const setZoomSafe = useCallback((nextZoom: number) => {
    setZoomLevel(clampNumber(nextZoom, 60, 180));
  }, []);

  const setOrderedListStyle = useCallback(
    (style: OrderedListStyleValue) => {
      if (!editor) return;
      const normalized = normalizeOrderedListStyle(style);
      let chain = editor.chain().focus();
      if (!editor.isActive("orderedList")) {
        chain = chain.toggleOrderedList();
      }
      chain.updateAttributes("orderedList", { listStyleType: normalized }).run();
      setMessage(`Numaralandirma bicimi: ${normalized}`);
    },
    [editor],
  );

  const createSuggestion = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      setMessage("Oneri icin once bir metin secin.");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, "\n", "\0").trim();
    if (!selectedText) {
      setMessage("Secilen metin bos.");
      return;
    }
    const proposedText = window.prompt("Onerilen yeni metin", selectedText);
    if (proposedText === null) return;
    const note = window.prompt("Kisa not (opsiyonel)", "") || "";
    setSuggestions((prev) => [
      {
        id: `s-${Date.now().toString(36)}`,
        selectedText,
        proposedText: proposedText.trim(),
        note: note.trim(),
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setMessage("Oneri eklendi.");
  }, [editor]);

  const createCommentFromSelection = useCallback(() => {
    if (!editor) return;
    if (!editor.isEditable) {
      setMessage("Yorum eklemek icin duzenleme moduna gecin.");
      return;
    }
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      setMessage("Yorum icin once bir metin secin.");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, "\n", "\0").trim();
    if (!selectedText) {
      setMessage("Secilen metin bos.");
      return;
    }
    const bodyRaw = window.prompt("Yorum", "");
    if (bodyRaw === null || !bodyRaw.trim()) return;
    const nowIso = new Date().toISOString();
    const comment: DocumentComment = {
      id: `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      body: bodyRaw.trim(),
      selectedText,
      createdAt: nowIso,
      resolved: false,
      from,
      to,
    };
    setDocumentComments((prev) => [comment, ...prev]);
    setActiveInspectorTab("comments");
    setMessage("Yorum eklendi.");
  }, [editor]);

  const focusCommentSelection = useCallback(
    (comment: DocumentComment) => {
      if (!editor) return;
      if (typeof comment.from !== "number" || typeof comment.to !== "number") {
        setMessage("Yorum secim konumu bulunamadi.");
        return;
      }
      const maxPos = Math.max(1, editor.state.doc.content.size);
      const from = clampNumber(comment.from, 1, maxPos);
      const to = clampNumber(comment.to, from, maxPos);
      editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
    },
    [editor],
  );

  const toggleCommentResolved = useCallback((commentId: string) => {
    setDocumentComments((prev) =>
      prev.map((item) =>
        item.id === commentId
          ? {
              ...item,
              resolved: !item.resolved,
            }
          : item,
      ),
    );
  }, []);

  const removeComment = useCallback((commentId: string) => {
    setDocumentComments((prev) => prev.filter((item) => item.id !== commentId));
  }, []);

  const createDocumentNote = useCallback(() => {
    const body = noteDraft.trim();
    if (!body) {
      setMessage("Not metni bos olamaz.");
      return;
    }
    if (!editor || !editor.isEditable) {
      setMessage("Not eklemek icin duzenleme moduna gecin.");
      return;
    }
    const nowIso = new Date().toISOString();
    let from: number | undefined;
    let to: number | undefined;
    let selectedText: string | undefined;
    if (editor && noteAttachSelection) {
      const selection = editor.state.selection;
      if (!selection.empty && selection.to > selection.from) {
        from = selection.from;
        to = selection.to;
        selectedText = editor.state.doc.textBetween(selection.from, selection.to, "\n", "\0").trim() || undefined;
      }
    }
    const note: DocumentNote = {
      id: `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      body,
      createdAt: nowIso,
      updatedAt: nowIso,
      pinned: false,
      tags: parseNoteTagsInput(noteTagsDraft),
      scope: noteScope,
      selectedText,
      from,
      to,
    };
    setDocumentNotes((prev) => normalizeDocumentNotes([note, ...prev]));
    setNoteDraft("");
    setNoteTagsDraft("");
    setActiveInspectorTab("notes");
    setMessage("Belge notu eklendi.");
  }, [editor, noteAttachSelection, noteDraft, noteScope, noteTagsDraft]);

  const createDocumentNoteFromPrompt = useCallback(() => {
    if (!editor) return;
    if (!editor.isEditable) {
      setMessage("Not eklemek icin duzenleme moduna gecin.");
      return;
    }
    const bodyRaw = window.prompt("Not", "");
    if (bodyRaw === null || !bodyRaw.trim()) return;
    const { from: selFrom, to: selTo, empty } = editor.state.selection;
    const selectedText = !empty
      ? editor.state.doc.textBetween(selFrom, selTo, "\n", "\0").trim() || undefined
      : undefined;
    const nowIso = new Date().toISOString();
    const note: DocumentNote = {
      id: `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      body: bodyRaw.trim(),
      createdAt: nowIso,
      updatedAt: nowIso,
      pinned: false,
      tags: [],
      scope: "PRIVATE",
      selectedText,
      from: !empty ? selFrom : undefined,
      to: !empty ? selTo : undefined,
    };
    setDocumentNotes((prev) => normalizeDocumentNotes([note, ...prev]));
    setActiveInspectorTab("notes");
    setMessage("Belge notu eklendi.");
  }, [editor]);

  const applyNoteQuickFilter = useCallback(
    (kind: "all" | "team" | "pinned" | "tag", tag?: string) => {
      if (kind === "all") {
        setNoteSearchQuery("");
        setNoteSearchScope("ALL");
        setNoteSearchPinnedOnly(false);
        return;
      }
      if (kind === "team") {
        setNoteSearchQuery("");
        setNoteSearchScope("TEAM");
        setNoteSearchPinnedOnly(false);
        return;
      }
      if (kind === "pinned") {
        setNoteSearchQuery("");
        setNoteSearchScope("ALL");
        setNoteSearchPinnedOnly(true);
        return;
      }
      const normalizedTag = (tag || "").trim().toLocaleLowerCase("tr");
      setNoteSearchQuery(normalizedTag);
      setNoteSearchScope("ALL");
      setNoteSearchPinnedOnly(false);
    },
    [],
  );

  const focusDocumentNoteSelection = useCallback(
    (note: DocumentNote) => {
      if (!editor) return;
      if (typeof note.from !== "number" || typeof note.to !== "number") {
        setMessage("Not secim konumu bulunamadi.");
        return;
      }
      const maxPos = Math.max(1, editor.state.doc.content.size);
      const from = clampNumber(note.from, 1, maxPos);
      const to = clampNumber(note.to, from, maxPos);
      editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
    },
    [editor],
  );

  const openFindMatchedNote = useCallback(
    (note: DocumentNote) => {
      setActiveInspectorTab("notes");
      if (typeof note.from === "number" && typeof note.to === "number") {
        focusDocumentNoteSelection(note);
        return;
      }
      setMessage("Not secim konumu olmadigi icin Notlar sekmesi acildi.");
    },
    [focusDocumentNoteSelection],
  );

  const toggleDocumentNotePinned = useCallback((noteId: string) => {
    setDocumentNotes((prev) =>
      normalizeDocumentNotes(
        prev.map((item) =>
          item.id === noteId
            ? {
                ...item,
                pinned: !item.pinned,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      ),
    );
  }, []);

  const removeDocumentNote = useCallback((noteId: string) => {
    setDocumentNotes((prev) => prev.filter((item) => item.id !== noteId));
  }, []);

  useEffect(() => {
    if (!editor) return;
    if (!commentsHydratedRef.current) {
      commentsHydratedRef.current = true;
      return;
    }
    const nowIso = new Date().toISOString();
    const canonical = buildCanonicalTree();
    if (!canonical) return;
    const currentTitle = deriveDocumentTitle(editor.getText(), docId);
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({ canonical, updatedAt: nowIso }),
    );
    syncLocalDocument({
      id: docId,
      title: currentTitle,
      status,
      updatedAt: nowIso,
    });
    if (!apiAvailable || readOnly || status === "FINAL" || status === "ARCHIVED") {
      setSaveState(apiAvailable ? "saved" : "offline");
      return;
    }
    setSaveState("saving");
    void apiRequest(`/documents/${docId}/autosave`, {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: 1,
        canonicalJson: canonical,
        recoveredFromCrash: false,
      }),
    })
      .then((saved) => {
        setSaveState(saved ? "saved" : "error");
      })
      .catch(() => {
        setSaveState("error");
      });
  }, [apiAvailable, buildCanonicalTree, docId, documentComments, draftKey, editor, readOnly, status, syncLocalDocument]);

  useEffect(() => {
    if (!apiAvailable || layout !== "full") {
      return;
    }
    const refreshAll = () => {
      void Promise.all([refreshExports(), refreshLinks(), refreshVersions()]);
    };
    refreshAll();
    const timer = window.setInterval(refreshAll, 20_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [apiAvailable, layout, refreshExports, refreshLinks, refreshVersions]);

  const insertMentionText = useCallback(() => {
    if (!editor || !mentionPreview) return;
    const payload = mentionPreview.text || mentionSource.find((item) => item.id === mentionPreview.id)?.text || "";
    if (!payload.trim()) {
      setMessage("Kanun metni bulunamadi.");
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection(mentionPreview.pos)
      .insertContent(`\n\n"${payload}" (${mentionPreview.label})\n`)
      .run();
    setMentionPreview(null);
  }, [editor, mentionPreview, mentionSource]);

  const copyInternalUdf = useCallback(async () => {
    if (!editor) return;
    const result = await copyInternalUdfFragment(editor);
    const warning = result.warnings[0];
    if (!result.ok) {
      setMessage(warning ? `UDF iç kopyala başarısız. ${warning}` : "UDF iç kopyala başarısız.");
      return;
    }
    if (result.mode === "rich") {
      setMessage(warning ? `UDF iç kopyala tamamlandı. ${warning}` : "UDF iç kopyala tamamlandı.");
      return;
    }
    if (result.mode === "html") {
      setMessage(warning ? `UDF iç kopyala HTML fallback ile tamamlandı. ${warning}` : "UDF iç kopyala HTML fallback ile tamamlandı.");
      return;
    }
    setMessage(warning ? `UDF iç kopyala text fallback ile tamamlandı. ${warning}` : "UDF iç kopyala text fallback ile tamamlandı.");
  }, [editor]);

  const copyForUyap = useCallback(async () => {
    if (!editor) return;
    const result = await copyUyapCompatible(editor);
    const warning = result.warnings[0];
    if (!result.ok) {
      setMessage(warning ? `UYAP uyumlu kopyalama başarısız. ${warning}` : "UYAP uyumlu kopyalama başarısız.");
      return;
    }
    if (result.mode === "html") {
      setMessage(warning ? `UYAP uyumlu kopyala tamamlandı. ${warning}` : "UYAP uyumlu kopyala tamamlandı.");
      return;
    }
    setMessage(warning ? `UYAP uyumlu kopyala text fallback ile tamamlandı. ${warning}` : "UYAP uyumlu kopyala text fallback ile tamamlandı.");
  }, [editor]);

  const downloadUdf = useCallback(() => {
    if (!editor) return;
    try {
      const result = downloadUdfFromEditorJson(editor.getJSON() as JSONContent, {
        documentId: docId,
        fileBaseName: `belge-${docId}`,
      });
      const validationErrorCount = result.validation.issues.filter(
        (item) => item.severity === "error",
      ).length;
      if (validationErrorCount > 0) {
        setMessage(
          `UDF indirildi fakat ${validationErrorCount} doğrulama hatası bulundu. Arşivi hedef ortamda kontrol edin.`,
        );
      } else if (result.warnings.length) {
        setMessage(`UDF indirildi (best effort). ${result.warnings.length} uyarı var.`);
      } else {
        setMessage("UDF indirildi.");
      }
    } catch {
      setMessage("UDF dosyası oluşturulamadı.");
    }
  }, [docId, editor]);

  const importUdf = useCallback(
    async (file: File) => {
      if (!editor) return;

      try {
        const imported = await importUdfFile(file);
        if (!applyEditorContent(imported.editorJson)) {
          setMessage("UDF icerigi gecersiz.");
          return;
        }

        if (imported.parserWarnings.length) {
          setMessage(
            `UDF yüklendi fakat ${imported.parserWarnings.length} parser uyarısı var.`,
          );
          return;
        }

        if (imported.docModel.warnings.length) {
          setMessage(
            `UDF yüklendi (best effort). ${imported.docModel.warnings.length} model uyarısı var.`,
          );
          return;
        }

        setMessage("UDF başarıyla yüklendi.");
      } catch {
        setMessage("UDF dosyası yüklenemedi.");
      }
    },
    [applyEditorContent, editor],
  );

  const exportWordLocal = useCallback(() => {
    if (!editor) return;
    const html = `<!doctype html><html><head><meta charset=\"utf-8\"/></head><body>${editor.getHTML()}</body></html>`;
    downloadBlob(`belge-${docId}.doc`, new Blob([html], { type: "application/msword;charset=utf-8" }));
    setMessage("Word dosyasi indirildi.");
  }, [docId, editor]);

  const saveLexgeLocal = useCallback(() => {
    if (!editor) return;
    const payload = JSON.stringify(editor.getJSON(), null, 2);
    downloadBlob(`belge-${docId}.lexge`, new Blob([payload], { type: "application/json;charset=utf-8" }));
    setMessage("Lexge dosyasi kaydedildi.");
  }, [docId, editor]);

  const saveCurrentDocument = useCallback(async () => {
    if (!editor) return;
    const nowIso = new Date().toISOString();
    const currentTitle = deriveDocumentTitle(editor.getText(), docId);
    const canonical = buildCanonicalTree();
    if (!canonical) return;
    if (apiAvailable && status !== "FINAL" && status !== "ARCHIVED") {
      setSaveState("saving");
      const saved = await apiRequest(`/documents/${docId}/autosave`, {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: 1,
          canonicalJson: canonical,
          recoveredFromCrash: false,
        }),
      }).catch(() => null);
      if (saved) {
        window.localStorage.removeItem(draftKey);
        setSaveState("saved");
        syncLocalDocument({
          id: docId,
          title: currentTitle,
          status,
          updatedAt: nowIso,
        });
        await refreshVersions();
        setMessage("Belge sunucuya kaydedildi.");
        return;
      }
      setSaveState("error");
    }
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({ canonical, updatedAt: nowIso }),
    );
    setSaveState(apiAvailable ? "error" : "offline");
    syncLocalDocument({
      id: docId,
      title: currentTitle,
      status,
      updatedAt: nowIso,
    });
    setMessage(
      apiAvailable
        ? "Sunucu kaydi basarisiz; taslak yerel olarak kaydedildi."
        : "Taslak yerel olarak kaydedildi.",
    );
  }, [apiAvailable, buildCanonicalTree, docId, draftKey, editor, refreshVersions, status, syncLocalDocument]);

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const withMod = event.ctrlKey || event.metaKey;
      if (!withMod) return;

      const target = event.target as HTMLElement | null;
      const isEditorTarget = Boolean(target?.closest(".ProseMirror")) || Boolean(editor?.isFocused);
      const canEditWithShortcut = Boolean(editor && editor.isEditable && isEditorTarget);

      if (key === "s") {
        event.preventDefault();
        void saveCurrentDocument();
        return;
      }
      if (!event.shiftKey && key === "f") {
        event.preventDefault();
        setIsFindBarOpen(true);
        window.setTimeout(() => findInputRef.current?.focus(), 0);
        return;
      }
      if (!event.shiftKey && key === "h") {
        event.preventDefault();
        setIsFindBarOpen(true);
        window.setTimeout(() => replaceInputRef.current?.focus(), 0);
        return;
      }
      if (event.shiftKey && key === "f") {
        event.preventDefault();
        setIsFocusMode((prev) => !prev);
        return;
      }
      if (event.shiftKey && key === "p") {
        event.preventDefault();
        setMode((prev) => (prev === "edit" ? "preview" : "edit"));
        return;
      }

      if (!canEditWithShortcut || !editor) return;

      if (!event.shiftKey && key === "a") {
        event.preventDefault();
        editor.chain().focus().selectAll().run();
        return;
      }
      if (!event.shiftKey && key === "x") {
        event.preventDefault();
        document.execCommand("cut");
        return;
      }
      if (event.altKey && key === "c") {
        event.preventDefault();
        void copyInternalUdf();
        return;
      }
      if (event.altKey && key === "u") {
        event.preventDefault();
        void copyForUyap();
        return;
      }
      if (!event.shiftKey && !event.altKey && key === "c") {
        event.preventDefault();
        document.execCommand("copy");
        return;
      }
      if (!event.shiftKey && !event.altKey && key === "v") {
        // Native paste behavior is preserved intentionally.
        return;
      }
      if (!event.shiftKey && key === "z") {
        event.preventDefault();
        editor.chain().focus().undo().run();
        return;
      }
      if ((!event.shiftKey && key === "y") || (event.shiftKey && key === "z")) {
        event.preventDefault();
        editor.chain().focus().redo().run();
        return;
      }
      if (!event.shiftKey && key === "b") {
        event.preventDefault();
        editor.chain().focus().toggleBold().run();
        return;
      }
      if (!event.shiftKey && key === "i") {
        event.preventDefault();
        editor.chain().focus().toggleItalic().run();
        return;
      }
      if (!event.shiftKey && key === "u") {
        event.preventDefault();
        editor.chain().focus().toggleUnderline().run();
        return;
      }
      if (event.shiftKey && event.code === "Digit7") {
        event.preventDefault();
        editor.chain().focus().toggleOrderedList().run();
        return;
      }
      if (event.shiftKey && event.code === "Digit8") {
        event.preventDefault();
        editor.chain().focus().toggleBulletList().run();
      }
    };
    window.addEventListener("keydown", handleShortcuts);
    return () => {
      window.removeEventListener("keydown", handleShortcuts);
    };
  }, [copyForUyap, copyInternalUdf, editor, saveCurrentDocument]);

  const insertPageBreak = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().setHorizontalRule().insertContent("<p></p>").run();
  }, [editor]);

  const autoFormatPages = useCallback(() => {
    if (!editor) return;
    let tr = editor.state.tr;
    const existingBreaks: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "horizontalRule") existingBreaks.push(pos);
    });
    existingBreaks.reverse().forEach((pos) => {
      tr = tr.delete(pos, pos + 1);
    });
    if (existingBreaks.length) editor.view.dispatch(tr);

    window.setTimeout(() => {
      const maxHeight = 930;
      let currentHeight = 0;
      const breaks: number[] = [];
      editor.state.doc.forEach((_node, offset) => {
        const domNode = editor.view.nodeDOM(offset) as HTMLElement | null;
        if (!domNode) return;
        const style = window.getComputedStyle(domNode);
        const nodeHeight =
          domNode.offsetHeight
          + Number.parseFloat(style.marginTop || "0")
          + Number.parseFloat(style.marginBottom || "0");
        if (!Number.isFinite(nodeHeight) || nodeHeight <= 0) return;
        if (currentHeight + nodeHeight > maxHeight) {
          breaks.push(offset);
          currentHeight = nodeHeight;
        } else {
          currentHeight += nodeHeight;
        }
      });
      if (!breaks.length) return;
      let chain = editor.chain().focus();
      breaks.reverse().forEach((pos) => {
        chain = chain.insertContentAt(pos, { type: "horizontalRule" });
      });
      chain.run();
    }, 80);
  }, [editor]);

  const focusFindMatch = useCallback((nextIndex: number) => {
    if (!editor || !findMatches.length) return;
    const safeIndex = ((nextIndex % findMatches.length) + findMatches.length) % findMatches.length;
    const match = findMatches[safeIndex];
    if (!match) return;
    setActiveFindMatch(safeIndex);
    editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();
  }, [editor, findMatches]);

  const goToFindDelta = useCallback((delta: number) => {
    if (!findMatches.length) return;
    if (activeFindMatch < 0) {
      focusFindMatch(delta >= 0 ? 0 : findMatches.length - 1);
      return;
    }
    focusFindMatch(activeFindMatch + delta);
  }, [activeFindMatch, findMatches.length, focusFindMatch]);

  const toggleFindScopeSelection = useCallback((checked: boolean) => {
    if (!checked) {
      setFindInSelection(false);
      setFindSelectionWindow(null);
      setActiveFindMatch(-1);
      return;
    }
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || to <= from) {
      setFindInSelection(false);
      setFindSelectionWindow(null);
      setMessage("Secimde arama icin once bir metin secin.");
      return;
    }
    setFindInSelection(true);
    setFindSelectionWindow({ from, to });
    setActiveFindMatch(-1);
  }, [editor]);

  const replaceCurrentFindMatch = useCallback(() => {
    if (!editor || !editor.isEditable) return;
    const query = findQuery.trim();
    if (!query) {
      setMessage("Degistir icin once bir arama metni girin.");
      return;
    }
    if (!findMatches.length) {
      setMessage("Degistirilecek eslesme bulunamadi.");
      return;
    }
    const safeIndex = activeFindMatch >= 0 ? activeFindMatch : 0;
    const match = findMatches[safeIndex] || findMatches[0];
    if (!match) return;

    editor
      .chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .insertContent(replaceQuery)
      .run();
    setMessage("Secili eslesme degistirildi.");
  }, [activeFindMatch, editor, findMatches, findQuery, replaceQuery]);

  const replaceAllFindMatches = useCallback(() => {
    if (!editor || !editor.isEditable) return;
    const query = findQuery.trim();
    if (!query) {
      setMessage("Tumunu degistir icin once bir arama metni girin.");
      return;
    }
    const ranges = toSafeReplaceRanges(findMatches);
    if (!ranges.length) {
      setMessage("Degistirilecek eslesme bulunamadi.");
      return;
    }

    let chain = editor.chain().focus();
    ranges.forEach((range) => {
      chain = chain.insertContentAt({ from: range.from, to: range.to }, replaceQuery);
    });
    chain.run();
    setActiveFindMatch(-1);
    setMessage(`${ranges.length} eslesme degistirildi.`);
  }, [editor, findMatches, findQuery, replaceQuery]);

  const editorReadOnly =
    readOnly ||
    mode === "preview" ||
    status === "FINAL" ||
    status === "ARCHIVED" ||
    (layout === "full" && !hasWriteLease);
  useEffect(() => { editor?.setEditable(!editorReadOnly); }, [editor, editorReadOnly]);

  const canEnterEdit = status !== "FINAL" && status !== "ARCHIVED" && hasWriteLease;
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 220));
  const wordGoalProgress = wordGoal > 0 ? Math.min(100, Math.round((wordCount / wordGoal) * 100)) : 0;
  const findProgressLabel = findMatches.length && activeFindMatch >= 0 ? `${activeFindMatch + 1}/${findMatches.length}` : `0/${findMatches.length}`;
  const saveStateLabel =
    saveState === "saving"
      ? "Kaydediliyor"
      : saveState === "saved"
        ? "Kaydedildi"
        : saveState === "error"
          ? "Kayit Hatasi"
          : saveState === "offline"
            ? "Yerel Kayit"
            : "Hazir";
  const saveStateClass =
    saveState === "saved"
      ? "bg-emerald-100 text-emerald-800"
      : saveState === "saving"
        ? "bg-blue-100 text-blue-800"
        : saveState === "error"
          ? "bg-rose-100 text-rose-800"
          : saveState === "offline"
            ? "bg-amber-100 text-amber-800"
            : "bg-slate-100 text-slate-700";
  const activePeersCount = peerSessions.length;
  const unresolvedCommentsCount = documentComments.filter((item) => !item.resolved).length;
  const pinnedNotesCount = documentNotes.filter((item) => item.pinned).length;
  const teamNotesCount = documentNotes.filter((item) => item.scope === "TEAM").length;
  const visibleNotesCount = filteredDocumentNotes.length;
  const statusOptions = DOC_STATUS_TRANSITIONS[status] || [];
  const toolbarMenuTriggerClass = (menu: Exclude<ToolbarMenu, null>) =>
    cn(
      "inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold leading-none whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
      openToolbarMenu === menu
        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
        : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
    );
  const toolbarMenuPanelClass =
    "fixed right-3 top-24 hidden w-[330px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.16)] md:block";
  const toolbarMenuPanelStyle = {
    zIndex: 320,
    top: 96,
    right: 12,
  } as const;
  const selectedTextColor = normalizePickerColor(String(editor?.getAttributes("textStyle").color || "").trim(), "#000000");
  const selectedHighlightColor = normalizePickerColor(String(editor?.getAttributes("highlight").color || "").trim(), "#F1C40F");
  const activeBlockAttrs = editor?.isActive("heading")
    ? editor.getAttributes("heading")
    : editor?.getAttributes("paragraph") || {};
  const activeLineHeight = String(activeBlockAttrs.lineHeight || "1.5");
  const paragraphSpacingValue = parseCssPixel(activeBlockAttrs.marginBottom, 0);
  const paragraphIndentValue = parseCssPixel(activeBlockAttrs.marginLeft, 0);
  const activeOrderedListStyle = normalizeOrderedListStyle(
    editor?.getAttributes("orderedList").listStyleType,
  );
  const zoomLabel = `${zoomLevel}%`;

  const colorMenuContent = (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Yazi Rengi</p>
          <button
            type="button"
            className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
            onClick={() => editor?.chain().focus().unsetColor().run()}
            disabled={editorReadOnly}
          >
            Otomatik
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_COLORS.map((color) => {
            const active = color.toUpperCase() === selectedTextColor.toUpperCase();
            return (
              <button
                key={`text-${color}`}
                type="button"
                disabled={editorReadOnly}
                onClick={() => editor?.chain().focus().setColor(color).run()}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-transform hover:scale-105",
                  active ? "border-slate-900 ring-2 ring-blue-200" : "border-white shadow-sm",
                )}
                style={{ backgroundColor: color }}
                aria-label={`Yazi rengi ${color}`}
                title={color}
              />
            );
          })}
        </div>
        <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
          Sonsuz Renk
          <input
            type="color"
            value={selectedTextColor}
            disabled={editorReadOnly}
            onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
          />
        </label>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vurgu Rengi</p>
          <button
            type="button"
            className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
            onClick={() => editor?.chain().focus().unsetHighlight().run()}
            disabled={editorReadOnly}
          >
            Otomatik
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_COLORS.map((color) => {
            const active = color.toUpperCase() === selectedHighlightColor.toUpperCase();
            return (
              <button
                key={`highlight-${color}`}
                type="button"
                disabled={editorReadOnly}
                onClick={() => editor?.chain().focus().setHighlight({ color }).run()}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-transform hover:scale-105",
                  active ? "border-slate-900 ring-2 ring-blue-200" : "border-white shadow-sm",
                )}
                style={{ backgroundColor: color }}
                aria-label={`Vurgu rengi ${color}`}
                title={color}
              />
            );
          })}
        </div>
        <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
          Sonsuz Renk
          <input
            type="color"
            value={selectedHighlightColor}
            disabled={editorReadOnly}
            onChange={(event) => editor?.chain().focus().setHighlight({ color: event.target.value }).run()}
          />
        </label>
      </div>
    </div>
  );

  const layoutMenuContent = (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Satir Araligi</p>
        <select
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
          value={activeLineHeight}
          disabled={editorReadOnly}
          onChange={(event) => setLineSpacing(event.target.value)}
        >
          <option value="1">1.0</option>
          <option value="1.15">1.15</option>
          <option value="1.5">1.5</option>
          <option value="2">2.0</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button label="Bosluk +" onClick={() => adjustParagraphSpacing(6)} disabled={editorReadOnly} className="h-8 px-2" />
        <Button label="Bosluk -" onClick={() => adjustParagraphSpacing(-6)} disabled={editorReadOnly} className="h-8 px-2" />
        <Button label="Girinti +" onClick={() => adjustParagraphIndent(12)} disabled={editorReadOnly} className="h-8 px-2" />
        <Button label="Girinti -" onClick={() => adjustParagraphIndent(-12)} disabled={editorReadOnly} className="h-8 px-2" />
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
        Aktif bosluk: {paragraphSpacingValue}px · Girinti: {paragraphIndentValue}px
      </div>
      <div className="space-y-1 border-t border-slate-100 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Numaralandirma Bicimi</p>
        <select
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
          value={activeOrderedListStyle}
          disabled={editorReadOnly}
          onChange={(event) => setOrderedListStyle(event.target.value as OrderedListStyleValue)}
        >
          <option value="decimal">1. 2. 3.</option>
          <option value="lower-alpha">a. b. c.</option>
          <option value="upper-alpha">A. B. C.</option>
          <option value="lower-roman">i. ii. iii.</option>
          <option value="upper-roman">I. II. III.</option>
        </select>
        <p className="text-[10px] text-slate-500">
          Secili numarali listeye uygulanir. Girinti ile cok seviyeli yapi kurabilirsiniz.
        </p>
      </div>
      <div className="space-y-1 border-t border-slate-100 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ust/Alt Bilgi</p>
        <input
          value={headerText}
          onChange={(event) => setHeaderText(event.target.value)}
          placeholder="Ust bilgi metni"
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
        />
        <input
          value={footerText}
          onChange={(event) => setFooterText(event.target.value)}
          placeholder="Alt bilgi metni"
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
        />
        <label className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
          <span>Sayfa numarasi goster</span>
          <input
            type="checkbox"
            checked={showPageNumbers}
            onChange={(event) => setShowPageNumbers(event.target.checked)}
          />
        </label>
      </div>
    </div>
  );

  const viewMenuContent = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button label="Duzenle" onClick={() => setMode("edit")} active={mode === "edit"} className="h-8 px-2" />
        <Button label="Onizle" onClick={() => setMode("preview")} active={mode === "preview"} className="h-8 px-2" />
        <Button label={isFocusMode ? "Odak Kapat" : "Odak Ac"} onClick={() => setIsFocusMode((prev) => !prev)} className="h-8 px-2" />
        <Button label={isFullscreen ? "Tam Ekran Kapat" : "Tam Ekran"} onClick={() => setIsFullscreen((prev) => !prev)} className="h-8 px-2" />
      </div>
      <div className="space-y-2 border-t border-slate-100 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Yakinlastirma</p>
        <div className="flex items-center gap-2">
          <Button label="-" onClick={() => setZoomSafe(zoomLevel - 10)} className="h-8 w-10 px-0" />
          <span className="inline-flex h-8 min-w-[64px] items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700">
            {zoomLabel}
          </span>
          <Button label="+" onClick={() => setZoomSafe(zoomLevel + 10)} className="h-8 w-10 px-0" />
          <Button label="100%" onClick={() => setZoomSafe(100)} className="h-8 px-2" />
        </div>
      </div>
    </div>
  );

  const referencesMenuContent = (
    <div className="space-y-2">
      <Button label="Yorum Ekle" onClick={createCommentFromSelection} disabled={editorReadOnly} className="h-8 w-full px-2" />
      <Button label="Not Ekle" onClick={createDocumentNoteFromPrompt} disabled={editorReadOnly} className="h-8 w-full px-2" />
      <Button label="Dipnot Ekle" onClick={insertFootnoteFromPrompt} disabled={editorReadOnly} className="h-8 w-full px-2" />
      <Button label="Aciklama Ekle" onClick={() => insertLegalBlock("explanations")} disabled={editorReadOnly} className="h-8 w-full px-2" />
      <Button label="Hukuki Nedenler" onClick={() => insertLegalBlock("legal_reasons")} disabled={editorReadOnly} className="h-8 w-full px-2" />
      <Button label="Deliller" onClick={() => insertLegalBlock("evidence")} disabled={editorReadOnly} className="h-8 w-full px-2" />
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
        Basvurular menusu dipnot ve hukuki referans bloklarini hizli ekler.
      </p>
    </div>
  );

  const outlineMenuContent = (
    <div className="space-y-2">
      <Button
        label="Icindekiler Ekle"
        onClick={insertTableOfContents}
        disabled={editorReadOnly}
        className="h-8 w-full px-2"
      />
      <Button
        label="Icindekiler Yenile"
        onClick={refreshTableOfContents}
        disabled={editorReadOnly}
        className="h-8 w-full px-2"
      />
      {outlineItems.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] text-slate-600">
          Baslik bulunamadi. Icindekiler icin H1/H2/H3 kullanin.
        </p>
      ) : (
        <div className="max-h-[260px] space-y-1 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-1.5">
          {outlineItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => focusOutlineItem(item)}
              className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-100"
            >
              <span className="truncate" style={{ paddingLeft: `${Math.max(0, item.level - 1) * 10}px` }}>
                {item.text}
              </span>
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">H{item.level}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const showInlinePageMeta = mode !== "preview" || !apiAvailable;

  const canvas = (
    <div
      className={cn(
        "relative z-0 mx-auto w-full max-w-[900px] rounded-[20px] border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.08)]",
        isFocusMode ? "max-w-[820px] border-slate-200 shadow-[0_20px_42px_rgba(15,23,42,0.12)]" : "",
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] font-medium text-slate-500 md:px-10">
        <span>{mode === "preview" ? "Preview mode" : "Draft mode"}</span>
        <span>
          Sozcuk: {wordCount} · Zoom: {zoomLabel}
        </span>
      </div>
      <div className="px-4 py-6 md:px-10 md:py-8">
        <div style={{ zoom: zoomLevel / 100 }}>
          {showInlinePageMeta && headerText ? (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              Ust Bilgi: {headerText}
            </div>
          ) : null}
          {mode === "preview" ? (
            previewLoading ? (
              <p className="text-sm text-slate-600">Preview yukleniyor...</p>
            ) : (
              <iframe
                title="preview"
                className="min-h-[940px] w-full border-0"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={previewHtml || ""}
              />
            )
          ) : (
            <EditorContent editor={editor} />
          )}
          {showInlinePageMeta && (footerText || showPageNumbers) ? (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              <span>{footerText ? `Alt Bilgi: ${footerText}` : "Alt Bilgi: -"}</span>
              {showPageNumbers ? <span>Sayfa 1</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const toolbar = (
    <div
      className="sticky top-0 border-b border-slate-200/70 bg-white/90 backdrop-blur"
      style={{ zIndex: 210 }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-2 py-2 md:px-6">
        <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-2 md:flex">
          <Button label="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={editorReadOnly} className="h-8 px-2.5" />
          <span className="h-5 w-px bg-slate-200" />

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("typography")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "typography" ? null : "typography"))}
            >
              Stiller
            </button>
            {openToolbarMenu === "typography" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      <div className="space-y-2">
                        <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hukuki Presetler</p>
                          <div className="space-y-1.5">
                            {LEGAL_STYLE_PRESETS.map((preset) => (
                              <button
                                key={`preset-desktop-${preset.id}`}
                                type="button"
                                onClick={() => applyLegalStylePreset(preset.id)}
                                disabled={editorReadOnly}
                                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                <p className="text-[11px] font-semibold text-slate-800">{preset.label}</p>
                                <p className="text-[10px] text-slate-500">{preset.description}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                        <select
                          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                          defaultValue="'Times New Roman',serif"
                          disabled={editorReadOnly}
                          onChange={(event) => editor?.chain().focus().setFontFamily(event.target.value).run()}
                        >
                          <option value="'Times New Roman',serif">Times New Roman</option>
                          <option value="Arial,Helvetica,sans-serif">Arial</option>
                          <option value="Calibri,'Segoe UI',sans-serif">Calibri</option>
                          <option value="Georgia,serif">Georgia</option>
                        </select>
                        <select
                          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                          defaultValue="16px"
                          disabled={editorReadOnly}
                          onChange={(event) => editor?.chain().focus().setMark("textStyle", { fontSize: event.target.value }).run()}
                        >
                          <option value="10px">10px</option>
                          <option value="11px">11px</option>
                          <option value="12px">12px</option>
                          <option value="14px">14px</option>
                          <option value="16px">16px</option>
                          <option value="18px">18px</option>
                          <option value="20px">20px</option>
                          <option value="24px">24px</option>
                        </select>
                        <div className="grid grid-cols-4 gap-2">
                          <Button label="Sola" onClick={() => editor?.chain().focus().setTextAlign("left").run()} active={Boolean(editor?.isActive({ textAlign: "left" }))} disabled={editorReadOnly} className="h-8 px-1.5" />
                          <Button label="Ortala" onClick={() => editor?.chain().focus().setTextAlign("center").run()} active={Boolean(editor?.isActive({ textAlign: "center" }))} disabled={editorReadOnly} className="h-8 px-1.5" />
                          <Button label="Saga" onClick={() => editor?.chain().focus().setTextAlign("right").run()} active={Boolean(editor?.isActive({ textAlign: "right" }))} disabled={editorReadOnly} className="h-8 px-1.5" />
                          <Button label="Yasla" onClick={() => editor?.chain().focus().setTextAlign("justify").run()} active={Boolean(editor?.isActive({ textAlign: "justify" }))} disabled={editorReadOnly} className="h-8 px-1.5" />
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <Button label="S" onClick={() => editor?.chain().focus().toggleStrike().run()} active={Boolean(editor?.isActive("strike"))} disabled={editorReadOnly} className="h-8 px-2" />
                          <Button label="Sub" onClick={() => editor?.chain().focus().toggleSubscript().run()} active={Boolean(editor?.isActive("subscript"))} disabled={editorReadOnly} className="h-8 px-2" />
                          <Button label="Sup" onClick={() => editor?.chain().focus().toggleSuperscript().run()} active={Boolean(editor?.isActive("superscript"))} disabled={editorReadOnly} className="h-8 px-2" />
                          <Button label="Task" onClick={() => editor?.chain().focus().toggleTaskList().run()} active={Boolean(editor?.isActive("taskList"))} disabled={editorReadOnly} className="h-8 px-2" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button label="Girinti +" onClick={indentListItem} disabled={editorReadOnly} className="h-8 px-2" />
                          <Button label="Girinti -" onClick={outdentListItem} disabled={editorReadOnly} className="h-8 px-2" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Button label="Link Ekle" onClick={setLinkFromPrompt} disabled={editorReadOnly} className="h-8 px-2" />
                          <Button label="Link Sil" onClick={() => editor?.chain().focus().unsetLink().run()} disabled={editorReadOnly} className="h-8 px-2" />
                          <Button label="Temizle" onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        </div>
                      </div>
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("color")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "color" ? null : "color"))}
            >
              Renk
            </button>
            {openToolbarMenu === "color" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      {colorMenuContent}
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("table")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "table" ? null : "table"))}
            >
              Tablo
            </button>
            {openToolbarMenu === "table" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      <div className="grid grid-cols-2 gap-2">
                        <Button label="Tablo +" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Tablo Sil" onClick={() => editor?.chain().focus().deleteTable().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Satir +" onClick={() => editor?.chain().focus().addRowAfter().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Satir -" onClick={() => editor?.chain().focus().deleteRow().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Sutun +" onClick={() => editor?.chain().focus().addColumnAfter().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Sutun -" onClick={() => editor?.chain().focus().deleteColumn().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Birlestir" onClick={() => editor?.chain().focus().mergeCells().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Ayir" onClick={() => editor?.chain().focus().splitCell().run()} disabled={editorReadOnly} className="h-8 px-2" />
                      </div>
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("insert")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "insert" ? null : "insert"))}
            >
              Ekle
            </button>
            {openToolbarMenu === "insert" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      <div className="grid grid-cols-1 gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Icerik Ekle</p>
                        <Button label="Gorsel URL" onClick={() => { const src = window.prompt("Gorsel URL", "https://"); if (src) editor?.chain().focus().setImage({ src }).run(); }} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Gorsel Yukle" onClick={() => imageInputRef.current?.click()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Sayfa Sonu" onClick={insertPageBreak} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Oto Sayfala" onClick={autoFormatPages} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Ayirici" onClick={() => editor?.chain().focus().setHorizontalRule().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="UDF indir" onClick={downloadUdf} className="h-8 px-2" />
                        <Button label="UDF yükle" onClick={() => udfInputRef.current?.click()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="UDF iç kopyala" onClick={() => { void copyInternalUdf(); }} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="UYAP uyumlu kopyala" onClick={() => { void copyForUyap(); }} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Word" onClick={exportWordLocal} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Lexge Kaydet" onClick={saveLexgeLocal} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label={isFullscreen ? "Kucult" : "Tam Ekran"} onClick={() => setIsFullscreen((v) => !v)} className="h-8 px-2" />
                      </div>
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("layout")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "layout" ? null : "layout"))}
            >
              Duzen
            </button>
            {openToolbarMenu === "layout" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      {layoutMenuContent}
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("view")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "view" ? null : "view"))}
            >
              Gorunum
            </button>
            {openToolbarMenu === "view" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      {viewMenuContent}
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("references")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "references" ? null : "references"))}
            >
              Basvurular
            </button>
            {openToolbarMenu === "references" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      {referencesMenuContent}
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass("outline")}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "outline" ? null : "outline"))}
            >
              Icindekiler
            </button>
            {openToolbarMenu === "outline" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      {outlineMenuContent}
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>

          <Button
            label={isFindBarOpen ? "Find Kapat" : "Find"}
            onClick={() => {
              setIsFindBarOpen((prev) => {
                const next = !prev;
                if (next) window.setTimeout(() => findInputRef.current?.focus(), 0);
                return next;
              });
            }}
            active={isFindBarOpen}
            className="h-8 px-2.5"
          />
          <Button label={isFocusMode ? "Odak Cik" : "Odak"} onClick={() => setIsFocusMode((prev) => !prev)} active={isFocusMode} className="h-8 px-2.5" />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-2 md:hidden">
          <Button label="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={editorReadOnly} className="h-9 flex-1 px-2" />
          <Button label="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={editorReadOnly} className="h-9 flex-1 px-2" />
          <Button label="Stiller" onClick={() => setOpenToolbarMenu((prev) => (prev === "typography" ? null : "typography"))} active={openToolbarMenu === "typography"} className="h-9 flex-1 px-2" />
          <Button label="Renk" onClick={() => setOpenToolbarMenu((prev) => (prev === "color" ? null : "color"))} active={openToolbarMenu === "color"} className="h-9 flex-1 px-2" />
          <Button label="Ekle" onClick={() => setOpenToolbarMenu((prev) => (prev === "insert" ? null : "insert"))} active={openToolbarMenu === "insert"} className="h-9 flex-1 px-2" />
          <Button label="Duzen" onClick={() => setOpenToolbarMenu((prev) => (prev === "layout" ? null : "layout"))} active={openToolbarMenu === "layout"} className="h-9 flex-1 px-2" />
          <Button label="Gorunum" onClick={() => setOpenToolbarMenu((prev) => (prev === "view" ? null : "view"))} active={openToolbarMenu === "view"} className="h-9 flex-1 px-2" />
          <Button label="Basvurular" onClick={() => setOpenToolbarMenu((prev) => (prev === "references" ? null : "references"))} active={openToolbarMenu === "references"} className="h-9 flex-1 px-2" />
          <Button label="Icindekiler" onClick={() => setOpenToolbarMenu((prev) => (prev === "outline" ? null : "outline"))} active={openToolbarMenu === "outline"} className="h-9 flex-1 px-2" />
          <Button label="Find" onClick={() => { setIsFindBarOpen(true); window.setTimeout(() => findInputRef.current?.focus(), 0); }} active={isFindBarOpen} className="h-9 flex-1 px-2" />
        </div>

        <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">
          <div className="inline-flex h-9 shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-slate-100/70 md:h-8">
            <button
              type="button"
              className={cn(
                "px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
                mode === "edit" ? "bg-white text-slate-900" : "text-slate-600 hover:bg-white/70",
              )}
              onClick={() => setMode("edit")}
              disabled={!canEnterEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className={cn(
                "px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
                mode === "preview" ? "bg-white text-slate-900" : "text-slate-600 hover:bg-white/70",
              )}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
          </div>
          <Button
            label={saveState === "saving" ? "Kaydediliyor" : "Kaydet"}
            onClick={() => { void saveCurrentDocument(); }}
            disabled={editorReadOnly || saveState === "saving"}
            variant="secondary"
            className="h-9 flex-1 px-2 md:h-8 md:flex-none md:px-2.5"
          />
          <Button
            label={creatingShareLink ? "Paylasiliyor" : "Paylas"}
            onClick={() => { void createShareLink(); }}
            disabled={creatingShareLink}
            variant="primary"
            className="h-9 flex-1 px-2 md:h-8 md:flex-none md:px-2.5"
          />
          <div data-export-menu className="relative flex-1 md:flex-none">
            <Button
              label={requestingExportFormat ? `${requestingExportFormat.toUpperCase()} Hazirlaniyor` : "Exportlar"}
              onClick={() => {
                setIsExportMenuOpen((prev) => !prev);
              }}
              disabled={Boolean(requestingExportFormat)}
              variant="secondary"
              className="h-9 w-full px-2 md:h-8 md:w-auto md:px-2.5"
            />
            {isExportMenuOpen ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-export-floating className="fixed right-3 top-20 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.16)]" style={{ zIndex: 9999, top: 80, right: 12 }}>
                      <button
                        type="button"
                        className={cn(
                          "flex h-8 w-full items-center rounded-md px-3 text-xs font-medium text-slate-700 hover:bg-slate-100",
                          requestingExportFormat ? "cursor-not-allowed opacity-55" : "",
                        )}
                        disabled={Boolean(requestingExportFormat)}
                        onClick={() => {
                          setIsExportMenuOpen(false);
                          downloadUdf();
                        }}
                      >
                        UDF indir
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "flex h-8 w-full items-center rounded-md px-3 text-xs font-medium text-slate-700 hover:bg-slate-100",
                          requestingExportFormat ? "cursor-not-allowed opacity-55" : "",
                        )}
                        disabled={Boolean(requestingExportFormat)}
                        onClick={() => {
                          setIsExportMenuOpen(false);
                          void requestExport("pdf");
                        }}
                      >
                        {requestingExportFormat === "pdf" ? "PDF Hazirlaniyor" : "PDF"}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "flex h-8 w-full items-center rounded-md px-3 text-xs font-medium text-slate-700 hover:bg-slate-100",
                          requestingExportFormat ? "cursor-not-allowed opacity-55" : "",
                        )}
                        disabled={Boolean(requestingExportFormat)}
                        onClick={() => {
                          setIsExportMenuOpen(false);
                          void requestExport("docx");
                        }}
                      >
                        {requestingExportFormat === "docx" ? "DOCX Hazirlaniyor" : "DOCX"}
                      </button>
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>
        </div>

        {newLink ? (
          <div className="mt-2 flex w-full flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/60 p-2">
            <input
              readOnly
              value={newLink}
              className="h-9 min-w-[220px] flex-1 rounded-md border border-blue-200 bg-white px-2 text-xs text-slate-700"
            />
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md border border-blue-300 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
              onClick={() => {
                void copyShareLink();
              }}
            >
              Kopyala
            </button>
            <a
              href={newLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md border border-blue-300 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
              Ac
            </a>
          </div>
        ) : null}

        {openToolbarMenu ? (
          typeof document !== "undefined"
            ? createPortal(
                <div
                  data-toolbar-floating
                  className="fixed right-3 top-24 max-h-[70vh] w-[min(92vw,340px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-[0_12px_28px_rgba(15,23,42,0.2)] md:hidden"
                  style={{ zIndex: 9999, top: 96, right: 12 }}
                >
                  {openToolbarMenu === "typography" ? (
                    <div className="space-y-2">
                      <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hukuki Presetler</p>
                        <div className="space-y-1.5">
                          {LEGAL_STYLE_PRESETS.map((preset) => (
                            <button
                              key={`preset-mobile-${preset.id}`}
                              type="button"
                              onClick={() => applyLegalStylePreset(preset.id)}
                              disabled={editorReadOnly}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              <p className="text-[11px] font-semibold text-slate-800">{preset.label}</p>
                              <p className="text-[10px] text-slate-500">{preset.description}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                      <select
                        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                        defaultValue="'Times New Roman',serif"
                        disabled={editorReadOnly}
                        onChange={(event) => editor?.chain().focus().setFontFamily(event.target.value).run()}
                      >
                        <option value="'Times New Roman',serif">Times New Roman</option>
                        <option value="Arial,Helvetica,sans-serif">Arial</option>
                        <option value="Calibri,'Segoe UI',sans-serif">Calibri</option>
                        <option value="Georgia,serif">Georgia</option>
                        <option value="Tahoma,Geneva,sans-serif">Tahoma</option>
                      </select>
                      <select
                        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                        defaultValue="16px"
                        disabled={editorReadOnly}
                        onChange={(event) => editor?.chain().focus().setMark("textStyle", { fontSize: event.target.value }).run()}
                      >
                        <option value="10px">10px</option>
                        <option value="11px">11px</option>
                        <option value="12px">12px</option>
                        <option value="14px">14px</option>
                        <option value="16px">16px</option>
                        <option value="18px">18px</option>
                        <option value="20px">20px</option>
                        <option value="24px">24px</option>
                      </select>
                      <select
                        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                        defaultValue="paragraph"
                        disabled={editorReadOnly}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (!editor) return;
                          if (value === "paragraph") {
                            editor.chain().focus().setParagraph().run();
                            return;
                          }
                          editor.chain().focus().toggleHeading({ level: Number.parseInt(value, 10) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
                        }}
                      >
                        <option value="paragraph">H/Paragraf</option>
                        <option value="1">H1</option>
                        <option value="2">H2</option>
                        <option value="3">H3</option>
                      </select>
                      <div className="grid grid-cols-3 gap-2">
                        <Button label="B" onClick={() => editor?.chain().focus().toggleBold().run()} active={Boolean(editor?.isActive("bold"))} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="I" onClick={() => editor?.chain().focus().toggleItalic().run()} active={Boolean(editor?.isActive("italic"))} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="U" onClick={() => editor?.chain().focus().toggleUnderline().run()} active={Boolean(editor?.isActive("underline"))} disabled={editorReadOnly} className="h-8 px-2" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button label="Liste" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={Boolean(editor?.isActive("bulletList"))} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Numarali" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={Boolean(editor?.isActive("orderedList"))} disabled={editorReadOnly} className="h-8 px-2" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button label="Girinti +" onClick={indentListItem} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Girinti -" onClick={outdentListItem} disabled={editorReadOnly} className="h-8 px-2" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Button label="Link Ekle" onClick={setLinkFromPrompt} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Link Sil" onClick={() => editor?.chain().focus().unsetLink().run()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Temizle" onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()} disabled={editorReadOnly} className="h-8 px-2" />
                      </div>
                    </div>
                  ) : null}
                  {openToolbarMenu === "color" ? (
                    colorMenuContent
                  ) : null}
                  {openToolbarMenu === "insert" ? (
                    <div className="grid grid-cols-1 gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Icerik Ekle</p>
                      <Button label="Gorsel URL" onClick={() => { const src = window.prompt("Gorsel URL", "https://"); if (src) editor?.chain().focus().setImage({ src }).run(); }} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Gorsel Yukle" onClick={() => imageInputRef.current?.click()} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Sayfa Sonu" onClick={insertPageBreak} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Oto Sayfala" onClick={autoFormatPages} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Ayirici" onClick={() => editor?.chain().focus().setHorizontalRule().run()} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="UDF indir" onClick={downloadUdf} className="h-8 px-2" />
                      <Button label="UDF yükle" onClick={() => udfInputRef.current?.click()} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="UDF iç kopyala" onClick={() => { void copyInternalUdf(); }} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="UYAP uyumlu kopyala" onClick={() => { void copyForUyap(); }} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Word" onClick={exportWordLocal} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Lexge Kaydet" onClick={saveLexgeLocal} disabled={editorReadOnly} className="h-8 px-2" />
                    </div>
                  ) : null}
                  {openToolbarMenu === "layout" ? (
                    layoutMenuContent
                  ) : null}
                  {openToolbarMenu === "view" ? (
                    viewMenuContent
                  ) : null}
                  {openToolbarMenu === "references" ? (
                    referencesMenuContent
                  ) : null}
                  {openToolbarMenu === "outline" ? (
                    outlineMenuContent
                  ) : null}
                </div>,
                document.body,
              )
            : null
        ) : null}

        <div className="w-full rounded-xl border border-slate-200 bg-slate-50/80 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["workflow", "Workflow"],
                ["versions", "Versiyonlar"],
                ["exports", "Export"],
                ["shares", "Paylasim"],
                ["library", "Kutuphane"],
                ["collab", "Isbirligi"],
                ["comments", "Yorumlar"],
                ["notes", "Notlar"],
                ["suggestions", "Oneriler"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveInspectorTab(id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-semibold transition",
                  activeInspectorTab === id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {activeInspectorTab === "workflow" ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-600">Durum</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {status}
                  </span>
                  <select
                    value={status}
                    onChange={(event) => {
                      void updateDocumentStatus(event.target.value as DocStatus);
                    }}
                    className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-700"
                    disabled={!canEnterEdit}
                  >
                    {[status, ...statusOptions].map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-600">Kayit Durumu</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", saveStateClass)}>
                    {saveStateLabel}
                  </span>
                  <Button
                    label="Kaydet"
                    onClick={() => {
                      void saveCurrentDocument();
                    }}
                    disabled={editorReadOnly}
                    className="h-7 px-2"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-600">Belge Islemi</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Button
                    label="Finalize"
                    onClick={() => {
                      void finalizeDocument();
                    }}
                    disabled={!canEnterEdit}
                    className="h-7 px-2"
                  />
                  <Button
                    label="Draft Kopya"
                    onClick={() => {
                      void forkDraft();
                    }}
                    className="h-7 px-2"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-600">Oneri Modu</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Button
                    label={suggestionMode ? "Oneri Acik" : "Oneri Kapali"}
                    onClick={() => setSuggestionMode((prev) => !prev)}
                    className="h-7 px-2"
                    active={suggestionMode}
                  />
                  <Button
                    label="Secimi Oneriye Cevir"
                    onClick={createSuggestion}
                    disabled={!suggestionMode}
                    className="h-7 px-2"
                  />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  Baslik sayisi: {outlineItems.length}
                </p>
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "versions" ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-600">
                  Son Surumler ({versions.length})
                </p>
                <Button
                  label="Yenile"
                  onClick={() => {
                    void refreshVersions();
                  }}
                  className="h-7 px-2"
                />
              </div>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5">
                {versions.length === 0 ? (
                  <p className="px-1 py-1 text-[11px] text-slate-500">Surum kaydi bulunamadi.</p>
                ) : (
                  versions.map((version) => (
                    <div key={version.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-700">
                          v{version.versionNumber}
                          {version.isFinalSnapshot ? " (Final Snapshot)" : ""}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          {formatDate(version.createdAt)} · {version.snapshotHash.slice(0, 10)}
                        </p>
                      </div>
                      <Button
                        label={restoringVersionId === version.id ? "Yukleniyor" : "Geri Yukle"}
                        onClick={() => {
                          void restoreVersion(version);
                        }}
                        disabled={
                          restoringVersionId !== null ||
                          status === "FINAL" ||
                          status === "ARCHIVED"
                        }
                        className="h-7 px-2"
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "exports" ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  label={requestingExportFormat === "pdf" ? "PDF Hazirlaniyor" : "PDF Istek"}
                  onClick={() => {
                    void requestExport("pdf");
                  }}
                  disabled={Boolean(requestingExportFormat)}
                  className="h-7 px-2"
                />
                <Button
                  label={requestingExportFormat === "docx" ? "DOCX Hazirlaniyor" : "DOCX Istek"}
                  onClick={() => {
                    void requestExport("docx");
                  }}
                  disabled={Boolean(requestingExportFormat)}
                  className="h-7 px-2"
                />
                <Button
                  label="Liste Yenile"
                  onClick={() => {
                    void refreshExports();
                  }}
                  className="h-7 px-2"
                />
              </div>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5">
                {exports.length === 0 ? (
                  <p className="px-1 py-1 text-[11px] text-slate-500">Export kaydi bulunamadi.</p>
                ) : (
                  exports.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-700">
                          {item.format} · {item.status}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          {formatDate(item.createdAt)}{item.completedAt ? ` -> ${formatDate(item.completedAt)}` : ""}
                        </p>
                      </div>
                      <Button
                        label={
                          downloadingExportId === item.id
                            ? "Hazirlaniyor"
                            : "COMPLETED" === item.status
                              ? "Indir"
                              : "Bekle"
                        }
                        onClick={() => {
                          void downloadExport(item.id);
                        }}
                        disabled={item.status !== "COMPLETED" || downloadingExportId !== null}
                        className="h-7 px-2"
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "shares" ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={permission}
                  onChange={(event) => setPermission(event.target.value as SharePermission)}
                  className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-700"
                >
                  <option value="VIEW">VIEW</option>
                  <option value="COMMENT">COMMENT</option>
                </select>
                <Button
                  label={creatingShareLink ? "Olusturuluyor" : "Link Olustur"}
                  onClick={() => {
                    void createShareLink();
                  }}
                  disabled={creatingShareLink}
                  className="h-7 px-2"
                />
                <Button
                  label="Liste Yenile"
                  onClick={() => {
                    void refreshLinks();
                  }}
                  className="h-7 px-2"
                />
              </div>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5">
                {links.length === 0 ? (
                  <p className="px-1 py-1 text-[11px] text-slate-500">Paylasim kaydi bulunamadi.</p>
                ) : (
                  links.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-700">
                          {item.permission} · {item.revokedAt ? "REVOKED" : "ACTIVE"}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          Olusma: {formatDate(item.createdAt)} · Son: {formatDate(item.lastAccessedAt)}
                        </p>
                      </div>
                      <Button
                        label={revokingShareId === item.id ? "Bekleyin" : "Revoke"}
                        onClick={() => {
                          void revokeShareLink(item.id);
                        }}
                        disabled={Boolean(item.revokedAt) || revokingShareId !== null}
                        className="h-7 px-2"
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "library" ? (
            <div className="mt-2 grid gap-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-1.5">
                <p className="px-1 text-[11px] font-semibold text-slate-600">Templates</p>
                <div className="mt-1 max-h-32 space-y-1 overflow-auto">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      className="block w-full rounded border border-slate-200 px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-100"
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-1.5">
                <p className="px-1 text-[11px] font-semibold text-slate-600">Clauses</p>
                <div className="mt-1 max-h-32 space-y-1 overflow-auto">
                  {clauses.map((clause) => (
                    <button
                      key={clause.id}
                      type="button"
                      onClick={() => insertClause(clause)}
                      className="block w-full rounded border border-slate-200 px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-100"
                    >
                      {clause.title}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-1.5">
                <p className="px-1 text-[11px] font-semibold text-slate-600">Dinamik Alanlar</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {LOCAL_DYNAMIC_FIELDS.map((field) => (
                    <button
                      key={field.fieldKey}
                      type="button"
                      onClick={() => insertDynamicField(field)}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                    >
                      {field.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-1.5">
                <p className="px-1 text-[11px] font-semibold text-slate-600">Hukuki Bloklar</p>
                <div className="mt-1 max-h-32 space-y-1 overflow-auto">
                  {LEGAL_BLOCKS.map((block) => (
                    <button
                      key={block.id}
                      type="button"
                      onClick={() => insertLegalBlock(block.id)}
                      className="block w-full rounded border border-slate-200 px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-100"
                    >
                      {block.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "collab" ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-600">Canli Kilit</p>
                {currentLock ? (
                  <p className="mt-1 text-[11px] text-slate-700">
                    Kilit sahibi: {currentLock.userId.slice(0, 10)}... · Bitis: {formatDate(currentLock.expiresAt)}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">Aktif kilit yok.</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-600">
                  Canli Oturumlar ({activePeersCount})
                </p>
                <div className="mt-1 max-h-20 space-y-1 overflow-auto">
                  {peerSessions.length === 0 ? (
                    <p className="text-[11px] text-slate-500">Ayni dokumanda diger aktif oturum gorunmuyor.</p>
                  ) : (
                    peerSessions.map((peer) => (
                      <p key={peer.id} className="text-[11px] text-slate-700">
                        {peer.id.slice(0, 10)}... · {peer.mode} · {formatDate(new Date(peer.updatedAt).toISOString())}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "comments" ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  label="Secimden Yorum Ekle"
                  onClick={createCommentFromSelection}
                  disabled={editorReadOnly}
                  className="h-7 px-2"
                />
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  Acik: {unresolvedCommentsCount}/{documentComments.length}
                </span>
              </div>
              <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5">
                {documentComments.length === 0 ? (
                  <p className="px-1 py-1 text-[11px] text-slate-500">Henuz yorum yok.</p>
                ) : (
                  documentComments.map((comment) => (
                    <div key={comment.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] font-semibold text-slate-700">
                          {comment.resolved ? "Cozuldu" : "Acik"} · {formatDate(comment.createdAt)}
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            label={comment.resolved ? "Geri Ac" : "Coz"}
                            onClick={() => toggleCommentResolved(comment.id)}
                            className="h-6 px-2"
                          />
                          <Button
                            label="Sil"
                            onClick={() => removeComment(comment.id)}
                            className="h-6 px-2"
                          />
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-700">{comment.body}</p>
                      <p className="mt-1 rounded bg-white px-1.5 py-1 text-[10px] text-slate-600">
                        Secim: {comment.selectedText}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <Button
                          label="Secime Git"
                          onClick={() => focusCommentSelection(comment)}
                          disabled={
                            typeof comment.from !== "number" ||
                            typeof comment.to !== "number"
                          }
                          className="h-6 px-2"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "notes" ? (
            <div className="mt-2 space-y-2">
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-600">Belge Notu Ekle</p>
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Kisa notunuzu yazin..."
                  className="mt-1 h-20 w-full resize-none rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-slate-500"
                />
                <div className="mt-1.5 grid gap-1.5 md:grid-cols-3">
                  <input
                    value={noteTagsDraft}
                    onChange={(event) => setNoteTagsDraft(event.target.value)}
                    placeholder="Etiketler: dava, acil"
                    className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-slate-500"
                  />
                  <select
                    value={noteScope}
                    onChange={(event) => setNoteScope(event.target.value as DocumentNoteScope)}
                    className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-slate-500"
                  >
                    <option value="PRIVATE">Ozel Not</option>
                    <option value="TEAM">Ekip Notu</option>
                  </select>
                  <label className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 text-[11px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={noteAttachSelection}
                      onChange={(event) => setNoteAttachSelection(event.target.checked)}
                    />
                    Secime bagla
                  </label>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Button
                    label="Not Ekle"
                    onClick={createDocumentNote}
                    disabled={editorReadOnly}
                    className="h-7 px-2"
                  />
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    Sabit: {pinnedNotesCount}/{documentNotes.length}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    Ekip: {teamNotesCount}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Hizli Filtre:</p>
                  <button
                    type="button"
                    onClick={() => applyNoteQuickFilter("all")}
                    className={cn(
                      "inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold transition",
                      noteSearchScope === "ALL" && !noteSearchPinnedOnly && !noteSearchQuery.trim()
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                    )}
                  >
                    Tum
                  </button>
                  <button
                    type="button"
                    onClick={() => applyNoteQuickFilter("team")}
                    className={cn(
                      "inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold transition",
                      noteSearchScope === "TEAM" && !noteSearchPinnedOnly && !noteSearchQuery.trim()
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                    )}
                  >
                    Ekip
                  </button>
                  <button
                    type="button"
                    onClick={() => applyNoteQuickFilter("pinned")}
                    className={cn(
                      "inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold transition",
                      noteSearchPinnedOnly && noteSearchScope === "ALL" && !noteSearchQuery.trim()
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                    )}
                  >
                    Sabit
                  </button>
                  {noteQuickTags.map((tag) => (
                    <button
                      key={`note-quick-tag-${tag}`}
                      type="button"
                      onClick={() => applyNoteQuickFilter("tag", tag)}
                      className={cn(
                        "inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold transition",
                        noteSearchScope === "ALL" && !noteSearchPinnedOnly && noteSearchQuery.trim().toLocaleLowerCase("tr") === tag
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                      )}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid gap-1.5 md:grid-cols-3">
                  <input
                    value={noteSearchQuery}
                    onChange={(event) => setNoteSearchQuery(event.target.value)}
                    placeholder="Notlarda ara..."
                    className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-slate-500"
                  />
                  <select
                    value={noteSearchScope}
                    onChange={(event) => setNoteSearchScope(event.target.value as "ALL" | DocumentNoteScope)}
                    className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-slate-500"
                  >
                    <option value="ALL">Tum Notlar</option>
                    <option value="PRIVATE">Sadece Ozel</option>
                    <option value="TEAM">Sadece Ekip</option>
                  </select>
                  <label className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 text-[11px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={noteSearchPinnedOnly}
                      onChange={(event) => setNoteSearchPinnedOnly(event.target.checked)}
                    />
                    Sadece Sabit
                  </label>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  Gorunen not: {visibleNotesCount}/{documentNotes.length}
                </p>
              </div>
              <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5">
                {visibleNotesCount === 0 ? (
                  <p className="px-1 py-1 text-[11px] text-slate-500">
                    {documentNotes.length === 0
                      ? "Henuz belge notu yok."
                      : "Filtreye uygun not bulunamadi."}
                  </p>
                ) : (
                  filteredDocumentNotes.map((note) => (
                    <div key={note.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] font-semibold text-slate-700">
                          {note.scope === "TEAM" ? "Ekip" : "Ozel"} · {formatDate(note.createdAt)}
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            label={note.pinned ? "Sabitlemeyi Kaldir" : "Sabitle"}
                            onClick={() => toggleDocumentNotePinned(note.id)}
                            className="h-6 px-2"
                          />
                          <Button
                            label="Sil"
                            onClick={() => removeDocumentNote(note.id)}
                            className="h-6 px-2"
                          />
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-700">{note.body}</p>
                      {note.tags.length ? (
                        <p className="mt-1 text-[10px] text-slate-500">Etiketler: {note.tags.join(", ")}</p>
                      ) : null}
                      {note.selectedText ? (
                        <p className="mt-1 rounded bg-white px-1.5 py-1 text-[10px] text-slate-600">
                          Secim: {note.selectedText}
                        </p>
                      ) : null}
                      <div className="mt-1 flex justify-end">
                        <Button
                          label="Secime Git"
                          onClick={() => focusDocumentNoteSelection(note)}
                          disabled={
                            typeof note.from !== "number" ||
                            typeof note.to !== "number"
                          }
                          className="h-6 px-2"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeInspectorTab === "suggestions" ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  label={suggestionMode ? "Oneri Modu Acik" : "Oneri Modu Kapali"}
                  onClick={() => setSuggestionMode((prev) => !prev)}
                  active={suggestionMode}
                  className="h-7 px-2"
                />
                <Button
                  label="Secimi Oneriye Cevir"
                  onClick={createSuggestion}
                  disabled={!suggestionMode}
                  className="h-7 px-2"
                />
              </div>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5">
                {suggestions.length === 0 ? (
                  <p className="px-1 py-1 text-[11px] text-slate-500">Henuz oneriniz yok.</p>
                ) : (
                  suggestions.map((item) => (
                    <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <p className="text-[11px] font-semibold text-slate-700">Secili Metin</p>
                      <p className="mt-0.5 text-[11px] text-slate-600">{item.selectedText}</p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-700">Oneri</p>
                      <p className="mt-0.5 text-[11px] text-slate-600">{item.proposedText}</p>
                      {item.note ? <p className="mt-1 text-[10px] text-slate-500">Not: {item.note}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {wordGoal > 0 ? (
            <span className="inline-flex min-w-[110px] items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Hedef: %{wordGoalProgress}
            </span>
          ) : null}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">Sozcuk: {wordCount}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">Okuma: {readingMinutes}dk</span>
        </div>

        {isFindBarOpen ? (
          <div className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50/90 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={findInputRef}
                value={findQuery}
                onChange={(event) => {
                  setFindQuery(event.target.value);
                  setActiveFindMatch(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    goToFindDelta(event.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="Belgede bul..."
                className="h-9 min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-700 outline-none focus:border-slate-500"
              />
              <input
                ref={replaceInputRef}
                value={replaceQuery}
                onChange={(event) => {
                  setReplaceQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (event.shiftKey) {
                    replaceAllFindMatches();
                    return;
                  }
                  replaceCurrentFindMatch();
                }}
                placeholder="Degistir..."
                className="h-9 min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-700 outline-none focus:border-slate-500"
              />
              <label className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={findCaseSensitive}
                  onChange={(event) => {
                    setFindCaseSensitive(event.target.checked);
                    setActiveFindMatch(-1);
                  }}
                />
                Harf duyarlı
              </label>
              <label className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={findWholeWord}
                  onChange={(event) => {
                    setFindWholeWord(event.target.checked);
                    setActiveFindMatch(-1);
                  }}
                />
                Tam kelime
              </label>
              <label className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={findInSelection}
                  onChange={(event) => {
                    toggleFindScopeSelection(event.target.checked);
                  }}
                />
                Secimde
              </label>
              <label className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={findIncludeNotes}
                  onChange={(event) => {
                    setFindIncludeNotes(event.target.checked);
                  }}
                />
                Notlarda
              </label>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{findProgressLabel}</span>
              {findIncludeNotes ? (
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                  Not: {findMatchedNotes.length}
                </span>
              ) : null}
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => goToFindDelta(-1)}
                disabled={!findMatches.length}
              >
                Onceki
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => goToFindDelta(1)}
                disabled={!findMatches.length}
              >
                Sonraki
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={replaceCurrentFindMatch}
                disabled={!findMatches.length || editorReadOnly}
              >
                Degistir
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={replaceAllFindMatches}
                disabled={!findMatches.length || editorReadOnly}
              >
                Tumunu Degistir
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setFindQuery("");
                  setFindMatches([]);
                  setActiveFindMatch(-1);
                  setFindInSelection(false);
                  setFindSelectionWindow(null);
                  setFindIncludeNotes(false);
                  setIsFindBarOpen(false);
                }}
              >
                Kapat
              </button>
            </div>
            {findIncludeNotes && findQuery.trim() ? (
              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-slate-700">Not Sonuclari</p>
                  <p className="text-[10px] text-slate-500">{findMatchedNotes.length} eslesme</p>
                </div>
                {findMatchedNotes.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Notlarda eslesen sonuc yok.</p>
                ) : (
                  <div className="max-h-36 space-y-1 overflow-auto">
                    {findMatchedNotes.map((note) => (
                      <button
                        key={`find-note-${note.id}`}
                        type="button"
                        onClick={() => openFindMatchedNote(note)}
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left hover:bg-slate-100"
                      >
                        <p className="truncate text-[11px] font-semibold text-slate-700">
                          {note.scope === "TEAM" ? "Ekip" : "Ozel"} · {formatDate(note.createdAt)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-600">{note.body}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) insertImageFile(file);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={udfInputRef}
          type="file"
          accept=".udf,application/zip,application/x-marinantex-udf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void importUdf(file);
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
    </div>
  );

  const embeddedContainerClass = isFullscreen
    ? "fixed inset-0 z-[120] space-y-4 overflow-y-auto bg-gradient-to-b from-stone-100 via-slate-50 to-stone-100 p-5"
    : "space-y-4";

  const fullContainerClass = cn(
    isFullscreen
      ? "fixed inset-0 z-[120] flex w-full flex-col overflow-hidden xl:flex-row"
      : "flex h-screen w-full flex-col overflow-hidden xl:flex-row",
    isFocusMode
      ? "bg-[#f8f8f6]"
      : "bg-gradient-to-b from-stone-100 via-slate-50 to-stone-100",
  );

  const mentionPreviewCard = mentionPreview ? (
    <div
      data-mention-preview
      className="fixed z-[132] w-[360px] rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_18px_46px_rgba(15,23,42,0.24)]"
      style={{ top: mentionPreview.top, left: mentionPreview.left, zIndex: 132 }}
    >
      <p className="text-sm font-semibold text-slate-900">{mentionPreview.label}</p>
      <p className="mt-1 line-clamp-5 text-xs leading-5 text-slate-600">{mentionPreview.text || "Kanun metni bulunamadi."}</p>
      <button
        type="button"
        className="mt-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100"
        onMouseDown={(event) => {
          event.preventDefault();
          insertMentionText();
        }}
      >
        Metne Ekle
      </button>
    </div>
  ) : null;

  if (layout === "embedded") {
    return (
      <div className={embeddedContainerClass}>
        {toolbar}
        {editor ? <BubbleMenu editor={editor} tippyOptions={{ duration: 120 }} className="flex gap-1 rounded-lg border border-slate-300 bg-white p-1 shadow-[0_10px_28px_rgba(15,23,42,0.16)]"><Button label="B" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} /><Button label="I" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} /></BubbleMenu> : null}
        {editor ? <FloatingMenu editor={editor} tippyOptions={{ duration: 120 }} className="flex gap-1 rounded-lg border border-slate-300 bg-white p-1 shadow-[0_10px_28px_rgba(15,23,42,0.16)]"><Button label="H1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} /><Button label="H2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} /></FloatingMenu> : null}
        {canvas}
        {mention ? (
          <div className="fixed z-[130] w-[340px] rounded-xl border border-slate-300 bg-white p-1 shadow-[0_18px_46px_rgba(15,23,42,0.28)]" style={{ top: mention.top, left: mention.left, zIndex: 130 }}>
            {mention.items.map((item, index) => (
              <button key={item.id} type="button" className={`block w-full rounded-lg px-2 py-2 text-left text-xs ${mention.selected === index ? "bg-slate-900 text-slate-100" : "text-slate-700 hover:bg-slate-100"}`} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().insertContentAt({ from: mention.from, to: mention.to }, { type: "lawMention", attrs: item }).insertContent(" ").run(); updateMention(null); }}>
                <p className="font-semibold">{item.label}</p>
                <p className="line-clamp-2 text-[11px] text-slate-500">{item.text}</p>
              </button>
            ))}
          </div>
        ) : null}
        {mentionPreviewCard}
      </div>
    );
  }

  return (
    <div className={fullContainerClass}>
      <main className={cn("relative isolate min-w-0 flex-1 overflow-y-auto", isFocusMode ? "pb-8" : "pb-20 xl:pb-0")}>
        {toolbar}
        <div className={cn("mx-auto max-w-[1280px] px-2 py-4 md:px-6", isFocusMode ? "pt-8" : "")}>{canvas}</div>
      </main>

      {message ? (
        <div className="pointer-events-none fixed inset-x-3 top-3 z-[140] flex justify-center md:inset-x-auto md:right-4 md:top-4" style={{ zIndex: 140 }}>
          <div className="pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
            <span>{message}</span>
            <button type="button" className="rounded-md px-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700" onClick={() => setMessage("")}>x</button>
          </div>
        </div>
      ) : null}

      {mention ? (
        <div className="fixed z-[130] w-[340px] rounded-xl border border-slate-300 bg-white p-1 shadow-[0_18px_46px_rgba(15,23,42,0.28)]" style={{ top: mention.top, left: mention.left, zIndex: 130 }}>
          {mention.items.map((item, index) => (
            <button key={item.id} type="button" className={`block w-full rounded-lg px-2 py-2 text-left text-xs ${mention.selected === index ? "bg-slate-900 text-slate-100" : "text-slate-700 hover:bg-slate-100"}`} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().insertContentAt({ from: mention.from, to: mention.to }, { type: "lawMention", attrs: item }).insertContent(" ").run(); updateMention(null); }}>
              <p className="font-semibold">{item.label}</p>
              <p className="line-clamp-2 text-[11px] text-slate-500">{item.text}</p>
            </button>
          ))}
        </div>
      ) : null}
      {mentionPreviewCard}

      <style jsx global>{`
        .ProseMirror { min-height: 940px; line-height: 1.72; color: #0f172a; counter-reset: footnote-counter; }
        .ProseMirror:focus { outline: none; }
        .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { color: #020617; letter-spacing: -0.01em; }
        .ProseMirror p { margin: 0.4rem 0; }
        .ProseMirror blockquote { border-left: 4px solid #475569; margin-left: 0; margin-right: 0; padding: 0.65rem 1rem; background-color: #f8fafc; color: #334155; border-radius: 0 8px 8px 0; }
        .ProseMirror table { border-collapse: collapse; width: 100%; border: 1px solid #64748b; }
        .ProseMirror td, .ProseMirror th { border: 1px solid #64748b; padding: 8px; vertical-align: top; }
        .law-mention-node { background: #e2e8f0; border: 1px solid #64748b; border-radius: 8px; color: #0f172a; padding: 2px 6px; font-size: 12px; font-weight: 700; }
        .dynamic-field-node { background: #f1f5f9; border: 1px solid #94a3b8; border-radius: 8px; color: #1e293b; padding: 2px 6px; font-size: 12px; font-weight: 700; }
        sup[data-footnote] { color: #334155; font-weight: 700; font-size: 11px; background: #e2e8f0; border: 1px solid #94a3b8; border-radius: 5px; padding: 1px 4px; margin: 0 2px; counter-increment: footnote-counter; }
        sup[data-footnote]::after { content: counter(footnote-counter); }
      `}</style>
    </div>
  );
}


