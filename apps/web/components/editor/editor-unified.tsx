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
import { downloadUdfFromEditorJson, importUdfFile } from "../../lib/editor/udf";

type Layout = "embedded" | "full";
type DocStatus = "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED";
type ExportStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "EXPIRED";
type SharePermission = "VIEW" | "COMMENT";
type SaveState = "idle" | "saving" | "saved" | "error" | "offline";
type ToolbarMenu = "typography" | "color" | "table" | "insert" | null;

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

interface SearchResult {
  id: string;
  title: string;
  content: string;
}

interface TemplateItem {
  id: string;
  name: string;
  documentType: string;
  schemaVersion: number;
  canonicalJson: { content: JSONContent };
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
}

interface ShareLinkItem {
  id: string;
  permission: SharePermission;
  expiresAt: string;
  revokedAt?: string | null;
  publicUrl?: string;
}

interface DynamicFieldDef {
  fieldKey: string;
  label: string;
  defaultValue?: string;
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
const LOCAL_DYNAMIC_FIELDS: DynamicFieldDef[] = [
  { fieldKey: "client_name", label: "Muvekkil Adi" },
  { fieldKey: "case_no", label: "Dosya No" },
];
const QUICK_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#CCCCCC",
  "#C00000", "#E67E22", "#F1C40F", "#2E7D32", "#1ABC9C",
  "#1976D2", "#283593", "#6A1B9A", "#AD1457", "#FFFFFF",
];
const LOCAL_DOCUMENT_INDEX_KEY = "editor-unified:document-index";

function toSafeDate(input?: string): number {
  if (!input) return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (!token || !tenantId) return null;
  return {
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:4000",
    token,
    tenantId,
  };
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T | null> {
  const ctx = readApiCtx();
  if (!ctx) return null;
  const response = await fetch(`${ctx.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.token}`,
      "x-tenant-id": ctx.tenantId,
      ...(init?.headers ?? {}),
    },
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

const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() { return { content: { default: "" } }; },
  parseHTML() { return [{ tag: "sup[data-footnote]" }]; },
  renderHTML({ HTMLAttributes }) { return ["sup", mergeAttributes(HTMLAttributes, { "data-footnote": "", title: HTMLAttributes.content }), "[Dipnot]"]; },
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [remoteMentionItems, setRemoteMentionItems] = useState<MentionItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>(LOCAL_TEMPLATES);
  const [clauses, setClauses] = useState<ClauseItem[]>(LOCAL_CLAUSES);
  const [exports, setExports] = useState<ExportItem[]>([]);
  const [links, setLinks] = useState<ShareLinkItem[]>([]);
  const [localDocuments, setLocalDocuments] = useState<DocumentListItem[]>([]);
  const [remoteDocuments, setRemoteDocuments] = useState<DocumentListItem[]>([]);
  const [creatingDocument, setCreatingDocument] = useState(false);
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
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [activeFindMatch, setActiveFindMatch] = useState(-1);
  const mentionRef = useRef<MentionUi | null>(null);
  const autosaveRef = useRef<number | null>(null);
  const lockRefreshRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const udfInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const findQueryRef = useRef("");
  const hydratedDraftRef = useRef(false);
  const lastToastRef = useRef<{ text: string; at: number } | null>(null);
  const mentionSource = useMemo(
    () => [
      ...(lawItems && lawItems.length ? lawItems : LOCAL_MENTIONS),
      ...remoteMentionItems,
      ...searchResults.map((r) => ({ id: r.id, label: r.title, text: r.content })),
    ],
    [lawItems, remoteMentionItems, searchResults],
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

  const documentItems = useMemo(() => {
    const merged = new Map<string, DocumentListItem>();
    remoteDocuments.forEach((item) => {
      merged.set(item.id, item);
    });
    localDocuments.forEach((item) => {
      if (merged.has(item.id)) {
        const existing = merged.get(item.id);
        if (existing) {
          merged.set(item.id, {
            ...existing,
            updatedAt: toSafeDate(item.updatedAt) > toSafeDate(existing.updatedAt) ? item.updatedAt : existing.updatedAt,
            title: existing.title || item.title,
          });
        }
      } else {
        merged.set(item.id, item);
      }
    });
    return Array.from(merged.values()).sort((a, b) => toSafeDate(b.updatedAt) - toSafeDate(a.updatedAt));
  }, [localDocuments, remoteDocuments]);

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

  const collectFindMatches = useCallback((instance: Editor, query: string): FindMatch[] => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (!needle) return [];
    const next: FindMatch[] = [];
    instance.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const lower = node.text.toLocaleLowerCase("tr");
      let start = 0;
      while (start < lower.length) {
        const index = lower.indexOf(needle, start);
        if (index === -1) break;
        const from = pos + index;
        const to = from + needle.length;
        const previewStart = Math.max(0, index - 20);
        const previewEnd = Math.min(node.text.length, index + needle.length + 20);
        next.push({
          from,
          to,
          preview: node.text.slice(previewStart, previewEnd),
        });
        start = index + needle.length;
      }
    });
    return next;
  }, []);

  useEffect(() => {
    if (layout !== "full" || typeof window === "undefined") return;
    const goalKey = `editor:word-goal:${docId}`;
    const focusKey = `editor:focus-mode:${docId}`;
    const rawGoal = window.localStorage.getItem(goalKey);
    const rawFocus = window.sessionStorage.getItem(focusKey);
    if (rawGoal) {
      const parsed = Number.parseInt(rawGoal, 10);
      if (Number.isFinite(parsed) && parsed >= 0) setWordGoal(parsed);
    }
    if (rawFocus === "1") setIsFocusMode(true);
  }, [docId, layout]);

  useEffect(() => {
    if (layout !== "full" || typeof window === "undefined") return;
    window.localStorage.setItem(`editor:word-goal:${docId}`, String(wordGoal));
    window.sessionStorage.setItem(`editor:focus-mode:${docId}`, isFocusMode ? "1" : "0");
  }, [docId, isFocusMode, layout, wordGoal]);

  useEffect(() => {
    findQueryRef.current = findQuery;
  }, [findQuery]);

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
    const syncApiAvailability = () => {
      setApiAvailable(Boolean(readApiCtx()));
    };
    syncApiAvailability();
    window.addEventListener("focus", syncApiAvailability);
    window.addEventListener("storage", syncApiAvailability);
    return () => {
      window.removeEventListener("focus", syncApiAvailability);
      window.removeEventListener("storage", syncApiAvailability);
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
      StarterKit, TextStyle, FontSize, FontFamily.configure({ types: ["textStyle"] }), Color, Highlight.configure({ multicolor: true }),
      Underline, Subscript, Superscript, TaskList, TaskItem.configure({ nested: true }), Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, Image.configure({ allowBase64: true }),
      LinkExtension.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }), TextAlign.configure({ types: ["heading", "paragraph"] }), CharacterCount,
      Placeholder.configure({ placeholder: "Belge metnini yazin veya @ ile kanun maddesi ekleyin..." }), Footnote, LawMention, DynamicField,
    ],
    content: initialContent ?? INITIAL_CONTENT,
    editorProps: {
      attributes: { class: "focus:outline-none max-w-none text-slate-900", style: "font-family:'Times New Roman',serif;" },
      handleKeyDown: (_view, event) => {
        const current = mentionRef.current;
        if (!current) return false;
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
        const nextMatches = collectFindMatches(editor, liveFindQuery);
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
          const canonical = {
            type: "tiptap_doc",
            schemaVersion: 1,
            content: editor.getJSON() as Record<string, unknown>,
          };
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
      editor.off("update", handleUpdate);
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [apiAvailable, collectFindMatches, collectOutlineItems, docId, draftKey, editor, mentionSource, mode, onChange, readOnly, status, syncLocalDocument, updateMention]);

  useEffect(() => {
    if (!editor) return;
    if (!findQuery.trim()) {
      setFindMatches([]);
      setActiveFindMatch(-1);
      return;
    }
    const nextMatches = collectFindMatches(editor, findQuery);
    setFindMatches(nextMatches);
    setActiveFindMatch((prev) => {
      if (!nextMatches.length) return -1;
      if (prev < 0) return 0;
      return Math.min(prev, nextMatches.length - 1);
    });
  }, [collectFindMatches, editor, findQuery]);

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
      editor.commands.setContent(parsed.canonical.content);
      setMessage("Yerel draft geri yuklendi.");
    } catch {
      // ignore malformed draft payload
    }
  }, [draftKey, editor]);

  const insertSnippet = useCallback((title: string, content: string, pos?: number) => {
    if (!editor) return;
    let chain = editor.chain().focus();
    if (typeof pos === "number") chain = chain.setTextSelection(pos);
    chain.insertContent(snippetHtml(title, content)).run();
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
      return;
    }
    void Promise.all([
      apiRequest<TemplateItem[]>("/templates").then((v) => v && setTemplates(v)).catch(() => null),
      apiRequest<ClauseItem[]>("/clauses").then((v) => v && setClauses(v)).catch(() => null),
      apiRequest<ExportItem[]>(`/documents/${docId}/exports`).then((v) => v && setExports(v)).catch(() => null),
      apiRequest<ShareLinkItem[]>(`/documents/${docId}/share-links`).then((v) => v && setLinks(v)).catch(() => null),
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
      const lock = await apiRequest(`/documents/${docId}/locks/acquire`, {
        method: "POST",
        body: JSON.stringify({ leaseSeconds: 120 }),
      }).catch(() => null);
      if (!active) return;
      if (!lock) {
        setHasWriteLease(false);
        setMode("preview");
        setMessage("Yazma kilidi alinamadi. Belge onizleme modunda acildi.");
        return;
      }
      setHasWriteLease(true);
      setMessage("");
      lockRefreshRef.current = window.setInterval(() => {
        void apiRequest(`/documents/${docId}/locks/refresh`, {
          method: "POST",
          body: JSON.stringify({ leaseSeconds: 120 }),
        }).catch(() => {
          setHasWriteLease(false);
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
      void apiRequest(`/documents/${docId}/locks/release`, {
        method: "POST",
        body: JSON.stringify({}),
      }).catch(() => null);
    };
  }, [apiAvailable, docId, layout]);

  useEffect(() => {
    if (layout !== "full" || mode !== "preview") return;
    setPreviewLoading(true);
    void apiRequest<{ html: string }>(`/documents/${docId}/print-preview`).then((v) => {
      setPreviewHtml(v?.html ?? `<!doctype html><html><body>${editor?.getHTML() || ""}</body></html>`);
    }).catch(() => setPreviewHtml(`<!doctype html><html><body>${editor?.getHTML() || ""}</body></html>`)).finally(() => setPreviewLoading(false));
  }, [docId, editor, layout, mode]);

  const search = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/legal-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
      const data = await res.json() as { results?: Array<{ id?: string; title?: string; content?: string }> };
      setSearchResults((data.results || []).map((x, i) => ({ id: x.id || `${x.title || "r"}-${i}`, title: x.title || `Sonuc ${i + 1}`, content: x.content || "" })));
    } catch {
      const q = searchQuery.toLocaleLowerCase("tr");
      setSearchResults(LOCAL_MENTIONS.filter((x) => `${x.label} ${x.text}`.toLocaleLowerCase("tr").includes(q)).map((x) => ({ id: x.id, title: x.label, content: x.text })));
      setMessage("Canli arama servisi yok; yerel kaynak kullanildi.");
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const refreshExports = useCallback(async () => {
    if (!apiAvailable) {
      setExports([]);
      return;
    }
    const list = await apiRequest<ExportItem[]>(`/documents/${docId}/exports`).catch(() => null);
    if (list) setExports(list);
  }, [apiAvailable, docId]);

  const requestExport = useCallback(async (format: "pdf" | "docx") => {
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
  }, [apiAvailable, docId, editor, refreshExports]);

  const downloadExport = useCallback(async (exportId: string) => {
    if (!apiAvailable) {
      setMessage("Yerel modda queue export indirme kapali.");
      return;
    }
    const signed = await apiRequest<{ signedUrl?: string }>(`/documents/${docId}/exports/${exportId}/signed-url`).catch(() => null);
    if (!signed?.signedUrl) {
      setMessage("Indirme linki olusturulamadi.");
      return;
    }
    window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
    await apiRequest(`/documents/${docId}/exports/${exportId}/downloaded`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => null);
  }, [apiAvailable, docId]);

  const refreshLinks = useCallback(async () => {
    if (!apiAvailable) {
      setLinks([]);
      return;
    }
    const list = await apiRequest<ShareLinkItem[]>(`/documents/${docId}/share-links`).catch(() => null);
    if (list) setLinks(list);
  }, [apiAvailable, docId]);

  const createShareLink = useCallback(async () => {
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
  }, [apiAvailable, docId, permission, refreshLinks]);

  const revokeShareLink = useCallback(async (shareLinkId: string) => {
    if (!apiAvailable) {
      setLinks((prev) => prev.filter((item) => item.id !== shareLinkId));
      setMessage("Yerel modda link kaydi sadece arayuzden kaldirildi.");
      return;
    }
    await apiRequest(`/documents/${docId}/share-links/${shareLinkId}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => null);
    await refreshLinks();
  }, [apiAvailable, docId, refreshLinks]);

  const forkDraft = useCallback(async () => {
    if (!apiAvailable) {
      setStatus("DRAFT");
      setMode("edit");
      setMessage("Yerel modda yeni dokuman olusturulamaz; mevcut belge taslaga cekildi.");
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
  }, [apiAvailable, docId]);

  const openDocumentFromList = useCallback((nextDocId: string) => {
    if (!nextDocId || nextDocId === docId) return;
    window.location.assign(`/editor/${nextDocId}`);
  }, [docId]);

  const createNewDocument = useCallback(async () => {
    if (creatingDocument) return;
    setCreatingDocument(true);
    const nowIso = new Date().toISOString();
    const title = `Belge ${new Date().toLocaleDateString("tr-TR")} ${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;

    try {
      if (apiAvailable) {
        const created = await apiRequest<{ id?: string; title?: string; status?: DocStatus; updatedAt?: string }>("/documents", {
          method: "POST",
          body: JSON.stringify({
            title,
            type: "PETITION",
            schemaVersion: 1,
            canonicalJson: {
              type: "tiptap_doc",
              schemaVersion: 1,
              content: INITIAL_CONTENT,
            },
          }),
        }).catch(() => null);

        if (!created?.id) {
          setMessage("Yeni belge olusturulamadi.");
          return;
        }

        syncLocalDocument({
          id: created.id,
          title: created.title || title,
          status: created.status || "DRAFT",
          updatedAt: created.updatedAt || nowIso,
        });
        void refreshDocumentList();
        window.location.assign(`/editor/${created.id}`);
        return;
      }

      const localId = `local-${Date.now().toString(36)}`;
      const localDraftKey = `editor-unified:draft:${localId}`;
      window.localStorage.setItem(
        localDraftKey,
        JSON.stringify({
          canonical: {
            type: "tiptap_doc",
            schemaVersion: 1,
            content: INITIAL_CONTENT,
          },
          updatedAt: nowIso,
        }),
      );
      syncLocalDocument({
        id: localId,
        title,
        status: "DRAFT",
        updatedAt: nowIso,
      });
      window.location.assign(`/editor/${localId}`);
    } finally {
      setCreatingDocument(false);
    }
  }, [apiAvailable, creatingDocument, refreshDocumentList, syncLocalDocument]);

  const updateDocumentStatus = useCallback(
    async (nextStatus: DocStatus) => {
      if (!apiAvailable) {
        setStatus(nextStatus);
        syncLocalDocument({
          id: docId,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        });
        if (nextStatus === "FINAL" || nextStatus === "ARCHIVED") {
          setMode("preview");
        }
        setMessage(`Yerel modda durum ${nextStatus} olarak guncellendi.`);
        return;
      }
      const updated = await apiRequest<{ status?: DocStatus }>(`/documents/${docId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      }).catch(() => null);
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
    },
    [apiAvailable, docId, syncLocalDocument],
  );

  const finalizeDocument = useCallback(async () => {
    if (!apiAvailable) {
      setStatus("FINAL");
      syncLocalDocument({
        id: docId,
        status: "FINAL",
        updatedAt: new Date().toISOString(),
      });
      setMode("preview");
      setMessage("Yerel modda finalize simulasyonu yapildi.");
      return;
    }
    const finalized = await apiRequest<{ status?: DocStatus }>(`/documents/${docId}/finalize`, {
      method: "POST",
      body: "{}",
    }).catch(() => null);
    if (!finalized?.status) {
      setMessage("Belge finalize edilemedi.");
      return;
    }
    setStatus(finalized.status);
    syncLocalDocument({
      id: docId,
      status: finalized.status,
      updatedAt: new Date().toISOString(),
    });
  }, [apiAvailable, docId, syncLocalDocument]);

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
        editor.commands.setContent(imported.editorJson);

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
    [editor],
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
    const canonical = {
      type: "tiptap_doc",
      schemaVersion: 1,
      content: editor.getJSON() as Record<string, unknown>,
    };
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
        setMessage("Belge sunucuya kaydedildi.");
        return;
      }
      setSaveState("error");
    }
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({ canonical, updatedAt: nowIso }),
    );
    setSaveState("offline");
    syncLocalDocument({
      id: docId,
      title: currentTitle,
      status,
      updatedAt: nowIso,
    });
    setMessage("Taslak yerel olarak kaydedildi.");
  }, [apiAvailable, docId, draftKey, editor, status, syncLocalDocument]);

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

  const focusOutlineItem = useCallback((pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
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
  const toolbarMenuTriggerClass =
    "inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium leading-none whitespace-nowrap text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";
  const toolbarMenuPanelClass =
    "fixed right-3 top-24 hidden w-[330px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.16)] md:block";
  const toolbarMenuPanelStyle = {
    zIndex: 320,
    top: 96,
    right: 12,
  } as const;
  const selectedTextColor = normalizePickerColor(String(editor?.getAttributes("textStyle").color || "").trim(), "#000000");
  const selectedHighlightColor = normalizePickerColor(String(editor?.getAttributes("highlight").color || "").trim(), "#F1C40F");

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

  const canvas = (
    <div
      className={cn(
        "relative z-0 mx-auto w-full max-w-[900px] rounded-[20px] border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.08)]",
        isFocusMode ? "max-w-[820px] border-slate-200 shadow-[0_20px_42px_rgba(15,23,42,0.12)]" : "",
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] font-medium text-slate-500 md:px-10">
        <span>{mode === "preview" ? "Preview mode" : "Draft mode"}</span>
        <span>Sozcuk: {wordCount}</span>
      </div>
      <div className="px-4 py-6 md:px-10 md:py-8">
        {mode === "preview" ? (
          previewLoading ? (
            <p className="text-sm text-slate-600">Preview yukleniyor...</p>
          ) : (
            <iframe title="preview" className="min-h-[940px] w-full border-0" srcDoc={previewHtml || ""} />
          )
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    </div>
  );

  const toolbar = (
    <div
      className="sticky top-0 border-b border-slate-200/70 bg-white/90 backdrop-blur"
      style={{ zIndex: 210 }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-2 py-2 md:px-6">
        <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 pb-1 pr-1 md:flex">
          <Button label="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={editorReadOnly} className="h-8 px-2.5" />
          <span className="h-5 w-px bg-slate-200" />
          <select
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
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
          <Button label="B" onClick={() => editor?.chain().focus().toggleBold().run()} active={Boolean(editor?.isActive("bold"))} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="I" onClick={() => editor?.chain().focus().toggleItalic().run()} active={Boolean(editor?.isActive("italic"))} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="U" onClick={() => editor?.chain().focus().toggleUnderline().run()} active={Boolean(editor?.isActive("underline"))} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="Link" onClick={() => { const href = window.prompt("URL", "https://"); if (href) editor?.chain().focus().extendMarkRange("link").setLink({ href }).run(); }} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="Liste" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={Boolean(editor?.isActive("bulletList"))} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="Numarali" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={Boolean(editor?.isActive("orderedList"))} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="Alinti" onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={Boolean(editor?.isActive("blockquote"))} disabled={editorReadOnly} className="h-8 px-2.5" />
          <Button label="Kod" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} active={Boolean(editor?.isActive("codeBlock"))} disabled={editorReadOnly} className="h-8 px-2.5" />
          <span className="h-5 w-px bg-slate-200" />

          <div data-toolbar-menu className="relative">
            <button
              type="button"
              className={toolbarMenuTriggerClass}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "typography" ? null : "typography"))}
            >
              Tipografi
            </button>
            {openToolbarMenu === "typography" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      <div className="space-y-2">
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
              className={toolbarMenuTriggerClass}
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
              className={toolbarMenuTriggerClass}
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
              className={toolbarMenuTriggerClass}
              onClick={() => setOpenToolbarMenu((prev) => (prev === "insert" ? null : "insert"))}
            >
              Ekle
            </button>
            {openToolbarMenu === "insert" ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-toolbar-floating className={toolbarMenuPanelClass} style={{ ...toolbarMenuPanelStyle, zIndex: 9999 }}>
                      <div className="grid grid-cols-1 gap-2">
                        <Button label="Gorsel URL" onClick={() => { const src = window.prompt("Gorsel URL", "https://"); if (src) editor?.chain().focus().setImage({ src }).run(); }} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Gorsel Yukle" onClick={() => imageInputRef.current?.click()} disabled={editorReadOnly} className="h-8 px-2" />
                        <Button label="Dipnot" onClick={() => { const note = window.prompt("Dipnot"); if (note) editor?.chain().focus().insertFootnote(note).run(); }} disabled={editorReadOnly} className="h-8 px-2" />
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

          <Button
            label={isFindBarOpen ? "Find Kapat" : "Find"}
            onClick={() => {
              setIsFindBarOpen((prev) => {
                const next = !prev;
                if (next) window.setTimeout(() => findInputRef.current?.focus(), 0);
                return next;
              });
            }}
            className="h-8 px-2.5"
          />
          <Button label={isFocusMode ? "Odak Cik" : "Odak"} onClick={() => setIsFocusMode((prev) => !prev)} className="h-8 px-2.5" />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:hidden">
          <Button label="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={editorReadOnly} className="h-9 flex-1 px-2" />
          <Button label="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={editorReadOnly} className="h-9 flex-1 px-2" />
          <Button label="Bicim" onClick={() => setOpenToolbarMenu((prev) => (prev === "typography" ? null : "typography"))} className="h-9 flex-1 px-2" />
          <Button label="Renk" onClick={() => setOpenToolbarMenu((prev) => (prev === "color" ? null : "color"))} className="h-9 flex-1 px-2" />
          <Button label="Ekle" onClick={() => setOpenToolbarMenu((prev) => (prev === "insert" ? null : "insert"))} className="h-9 flex-1 px-2" />
          <Button label="Find" onClick={() => { setIsFindBarOpen(true); window.setTimeout(() => findInputRef.current?.focus(), 0); }} className="h-9 flex-1 px-2" />
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
            label="Kaydet"
            onClick={() => { void saveCurrentDocument(); }}
            disabled={editorReadOnly}
            variant="secondary"
            className="h-9 flex-1 px-2 md:h-8 md:flex-none md:px-2.5"
          />
          <Button
            label="Paylaş"
            onClick={() => { void createShareLink(); }}
            variant="primary"
            className="h-9 flex-1 px-2 md:h-8 md:flex-none md:px-2.5"
          />
          <div data-export-menu className="relative flex-1 md:flex-none">
            <Button
              label="Exportlar"
              onClick={() => {
                setIsExportMenuOpen((prev) => !prev);
              }}
              variant="secondary"
              className="h-9 w-full px-2 md:h-8 md:w-auto md:px-2.5"
            />
            {isExportMenuOpen ? (
              typeof document !== "undefined"
                ? createPortal(
                    <div data-export-floating className="fixed right-3 top-20 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.16)]" style={{ zIndex: 9999, top: 80, right: 12 }}>
                      <button
                        type="button"
                        className="flex h-8 w-full items-center rounded-md px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          setIsExportMenuOpen(false);
                          downloadUdf();
                        }}
                      >
                        UDF indir
                      </button>
                      <button
                        type="button"
                        className="flex h-8 w-full items-center rounded-md px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          setIsExportMenuOpen(false);
                          void requestExport("pdf");
                        }}
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        className="flex h-8 w-full items-center rounded-md px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          setIsExportMenuOpen(false);
                          void requestExport("docx");
                        }}
                      >
                        DOCX
                      </button>
                    </div>,
                    document.body,
                  )
                : null
            ) : null}
          </div>
        </div>

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
                    </div>
                  ) : null}
                  {openToolbarMenu === "color" ? (
                    colorMenuContent
                  ) : null}
                  {openToolbarMenu === "insert" ? (
                    <div className="grid grid-cols-1 gap-2">
                      <Button label="Gorsel URL" onClick={() => { const src = window.prompt("Gorsel URL", "https://"); if (src) editor?.chain().focus().setImage({ src }).run(); }} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Gorsel Yukle" onClick={() => imageInputRef.current?.click()} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Dipnot" onClick={() => { const note = window.prompt("Dipnot"); if (note) editor?.chain().focus().insertFootnote(note).run(); }} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Sayfa Sonu" onClick={insertPageBreak} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Oto Sayfala" onClick={autoFormatPages} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="UDF indir" onClick={downloadUdf} className="h-8 px-2" />
                      <Button label="UDF yükle" onClick={() => udfInputRef.current?.click()} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="UDF iç kopyala" onClick={() => { void copyInternalUdf(); }} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="UYAP uyumlu kopyala" onClick={() => { void copyForUyap(); }} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Word" onClick={exportWordLocal} disabled={editorReadOnly} className="h-8 px-2" />
                      <Button label="Lexge Kaydet" onClick={saveLexgeLocal} disabled={editorReadOnly} className="h-8 px-2" />
                    </div>
                  ) : null}
                </div>,
                document.body,
              )
            : null
        ) : null}

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
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{findProgressLabel}</span>
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
                onClick={() => {
                  setFindQuery("");
                  setFindMatches([]);
                  setActiveFindMatch(-1);
                  setIsFindBarOpen(false);
                }}
              >
                Kapat
              </button>
            </div>
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
        .ProseMirror { min-height: 940px; line-height: 1.72; color: #0f172a; }
        .ProseMirror:focus { outline: none; }
        .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { color: #020617; letter-spacing: -0.01em; }
        .ProseMirror p { margin: 0.4rem 0; }
        .ProseMirror blockquote { border-left: 4px solid #475569; margin-left: 0; margin-right: 0; padding: 0.65rem 1rem; background-color: #f8fafc; color: #334155; border-radius: 0 8px 8px 0; }
        .ProseMirror table { border-collapse: collapse; width: 100%; border: 1px solid #64748b; }
        .ProseMirror td, .ProseMirror th { border: 1px solid #64748b; padding: 8px; vertical-align: top; }
        .law-mention-node { background: #e2e8f0; border: 1px solid #64748b; border-radius: 8px; color: #0f172a; padding: 2px 6px; font-size: 12px; font-weight: 700; }
        .dynamic-field-node { background: #f1f5f9; border: 1px solid #94a3b8; border-radius: 8px; color: #1e293b; padding: 2px 6px; font-size: 12px; font-weight: 700; }
        sup[data-footnote] { color: #334155; font-weight: 700; font-size: 11px; background: #e2e8f0; border: 1px solid #94a3b8; border-radius: 5px; padding: 1px 4px; margin: 0 2px; }
      `}</style>
    </div>
  );
}


