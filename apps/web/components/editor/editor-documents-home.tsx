"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FilePlus2,
  FileText,
  Files,
  LayoutGrid,
  Loader2,
  PencilLine,
  RefreshCw,
  Rows3,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

type DocumentStatus = "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED" | string;
type StatusFilter = "ALL" | "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED";
type ViewMode = "table" | "cards";

interface ApiContext {
  apiBaseUrl: string;
  token: string | null;
  tenantId: string | null;
}

interface LocalDocumentRecord {
  id: string;
  title?: string;
  status?: DocumentStatus;
  updatedAt?: string;
  createdAt?: string;
  type?: string;
}

interface DocumentListItem {
  id: string;
  title: string;
  status: DocumentStatus;
  updatedAt: string;
  createdAt?: string;
  type?: string;
  source: "local" | "remote";
}

const LOCAL_DOCUMENT_INDEX_KEY = "editor-unified:document-index";
const MAX_LOCAL_INDEX_SIZE = 60;
const REMOTE_LIST_UNAVAILABLE_WITH_LOCAL =
  "Uzak belge listesi su an alinamiyor; yerel belgeler gosteriliyor.";
const REMOTE_LIST_UNAVAILABLE_EMPTY =
  "Uzak belge listesine erisilemiyor. Oturum acik degilse tekrar giris yapip yeniden deneyin.";
const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "ALL", label: "Tum Belgeler" },
  { id: "DRAFT", label: "Taslaklar" },
  { id: "REVIEW", label: "Incelemede" },
  { id: "FINAL", label: "Final" },
  { id: "ARCHIVED", label: "Arsiv" },
];

const INITIAL_EDITOR_CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Belge metnini yazin..." }],
    },
  ],
} as const;

function toSafeDate(input?: string): number {
  if (!input) return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(input?: string): string {
  if (!input) return "-";
  const value = new Date(input);
  if (!Number.isFinite(value.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function fallbackTitle(docId: string): string {
  if (!docId || docId === "new") return "Yeni Belge";
  if (docId.startsWith("local-")) return `Yerel Belge ${docId.slice(6, 10)}`;
  return `Belge ${docId.slice(0, 8)}`;
}

function readApiContext(): ApiContext | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("mx_access_token");
  const tenantId = window.localStorage.getItem("mx_tenant_id");
  return {
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:4000",
    token,
    tenantId,
  };
}

async function canUseApi(context: ApiContext): Promise<boolean> {
  try {
    const response = await fetch(`${context.apiBaseUrl}/auth/me`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: buildApiAuthHeaders(context),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function buildApiAuthHeaders(context: ApiContext): Record<string, string> {
  const headers: Record<string, string> = {};
  if (context.token) {
    headers.Authorization = `Bearer ${context.token}`;
  }
  if (context.tenantId) {
    headers["x-tenant-id"] = context.tenantId;
  }
  return headers;
}

function buildApiHeaders(context: ApiContext): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...buildApiAuthHeaders(context),
  };
}

function readLocalIndex(): DocumentListItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LOCAL_DOCUMENT_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalDocumentRecord[];
    if (!Array.isArray(parsed)) return [];

    const items: DocumentListItem[] = [];
    parsed.forEach((item) => {
      const id = String(item.id || "").trim();
      if (!id) return;
      items.push({
        id,
        title: String(item.title || "").trim() || fallbackTitle(id),
        status: String(item.status || "DRAFT").toUpperCase(),
        updatedAt: item.updatedAt || new Date(0).toISOString(),
        createdAt: item.createdAt,
        type: item.type,
        source: "local",
      });
    });
    const deduped = new Map<string, DocumentListItem>();
    items.forEach((item) => {
      const existing = deduped.get(item.id);
      if (!existing || toSafeDate(item.updatedAt) >= toSafeDate(existing.updatedAt)) {
        deduped.set(item.id, item);
      }
    });
    return Array.from(deduped.values()).sort((a, b) => toSafeDate(b.updatedAt) - toSafeDate(a.updatedAt));
  } catch {
    return [];
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function parseRemoteDocuments(payload: unknown): DocumentListItem[] {
  const root = asRecord(payload);
  const rows =
    Array.isArray(payload)
      ? payload
      : Array.isArray(root?.items)
        ? root.items
        : Array.isArray(root?.data)
          ? root.data
          : [];

  const items: DocumentListItem[] = [];
  rows.forEach((entry) => {
    const record = asRecord(entry);
    if (!record) return;

    const id = readFirstString(record, ["id", "documentId", "document_id"]);
    if (!id) return;

    const title = readFirstString(record, ["title", "name"]) || fallbackTitle(id);
    const status = readFirstString(record, ["status"]) || "DRAFT";
    const updatedAt =
      readFirstString(record, ["updatedAt", "updated_at", "modifiedAt", "lastModifiedAt", "createdAt"]) ||
      new Date(0).toISOString();
    const createdAt = readFirstString(record, ["createdAt", "created_at"]);
    const type = readFirstString(record, ["type", "documentType", "document_type"]);

    items.push({
      id,
      title,
      status: status.toUpperCase(),
      updatedAt,
      createdAt,
      type,
      source: "remote",
    });
  });
  return items.sort((a, b) => toSafeDate(b.updatedAt) - toSafeDate(a.updatedAt));
}

function mergeDocuments(local: DocumentListItem[], remote: DocumentListItem[]): DocumentListItem[] {
  const merged = new Map<string, DocumentListItem>();

  remote.forEach((item) => {
    merged.set(item.id, item);
  });

  local.forEach((item) => {
    if (!merged.has(item.id)) {
      merged.set(item.id, item);
      return;
    }
    const existing = merged.get(item.id);
    if (!existing) return;
    const updatedAt =
      toSafeDate(item.updatedAt) > toSafeDate(existing.updatedAt) ? item.updatedAt : existing.updatedAt;
    merged.set(item.id, {
      ...existing,
      updatedAt,
      title: existing.title || item.title,
      createdAt: existing.createdAt || item.createdAt,
      type: existing.type || item.type,
    });
  });

  return Array.from(merged.values()).sort((a, b) => toSafeDate(b.updatedAt) - toSafeDate(a.updatedAt));
}

function statusClass(status: DocumentStatus): string {
  const value = status.toUpperCase();
  if (value === "FINAL") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (value === "REVIEW") return "bg-amber-50 text-amber-700 border-amber-200";
  if (value === "ARCHIVED") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

function normalizeStatus(status: DocumentStatus): StatusFilter {
  const value = status.toUpperCase();
  if (value === "REVIEW" || value === "FINAL" || value === "ARCHIVED") return value;
  return "DRAFT";
}

function isToday(input?: string): boolean {
  if (!input) return false;
  const value = new Date(input);
  if (!Number.isFinite(value.getTime())) return false;
  const now = new Date();
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate()
  );
}

export function EditorDocumentsHome() {
  const router = useRouter();
  const loadRequestIdRef = useRef(0);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadDocuments = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const isCurrentRequest = () => loadRequestIdRef.current === requestId;
    const silent = Boolean(options?.silent);
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);

    try {
      const localItems = readLocalIndex();
      const apiContext = readApiContext();
      if (!apiContext) {
        if (!isCurrentRequest()) return;
        setDocuments(localItems);
        return;
      }
      const apiReady = await canUseApi(apiContext);
      if (!apiReady) {
        if (!isCurrentRequest()) return;
        setDocuments(localItems);
        setLoadError(
          localItems.length > 0 ? REMOTE_LIST_UNAVAILABLE_WITH_LOCAL : REMOTE_LIST_UNAVAILABLE_EMPTY,
        );
        return;
      }

      const response = await fetch(`${apiContext.apiBaseUrl}/documents?limit=60`, {
        method: "GET",
        credentials: "include",
        headers: buildApiHeaders(apiContext),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Belge listesi alinamadi (${response.status}).`);
      }

      const text = await response.text();
      const payload = text ? JSON.parse(text) : [];
      const remoteItems = parseRemoteDocuments(payload);
      if (!isCurrentRequest()) return;
      setDocuments(mergeDocuments(localItems, remoteItems));
    } catch (error) {
      if (!isCurrentRequest()) return;
      const localItems = readLocalIndex();
      setDocuments(localItems);
      if (localItems.length > 0) {
        setLoadError(REMOTE_LIST_UNAVAILABLE_WITH_LOCAL);
      } else {
        const message = error instanceof Error ? error.message : "Belge listesi alinirken beklenmeyen hata olustu.";
        setLoadError(message || REMOTE_LIST_UNAVAILABLE_EMPTY);
      }
    } finally {
      if (!isCurrentRequest()) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const stats = useMemo(() => {
    const draftCount = documents.filter((item) => normalizeStatus(item.status) === "DRAFT").length;
    const reviewCount = documents.filter((item) => normalizeStatus(item.status) === "REVIEW").length;
    const finalCount = documents.filter((item) => normalizeStatus(item.status) === "FINAL").length;
    const updatedTodayCount = documents.filter((item) => isToday(item.updatedAt)).length;
    return {
      total: documents.length,
      draftCount,
      reviewCount,
      finalCount,
      updatedTodayCount,
    };
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    return documents.filter((item) => {
      const statusMatches = statusFilter === "ALL" || normalizeStatus(item.status) === statusFilter;
      if (!statusMatches) return false;
      if (!needle) return true;
      const haystack = `${item.title} ${item.id} ${item.status} ${item.type || ""}`.toLocaleLowerCase("tr");
      return haystack.includes(needle);
    });
  }, [documents, query, statusFilter]);

  const createDocument = useCallback(async (options?: { templateLabel?: string; type?: string }) => {
    if (isCreating) return;
    setIsCreating(true);
    setCreateError(null);

    try {
      const templateLabel = options?.templateLabel?.trim() || "Belge";
      const documentType = options?.type?.trim() || "PETITION";
      const apiContext = readApiContext();
      if (apiContext && (await canUseApi(apiContext))) {
        const title = `${templateLabel} ${new Date().toLocaleDateString("tr-TR")} ${new Date().toLocaleTimeString("tr-TR", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;

        const response = await fetch(`${apiContext.apiBaseUrl}/documents`, {
          method: "POST",
          credentials: "include",
          headers: buildApiHeaders(apiContext),
          body: JSON.stringify({
            title,
            type: documentType,
            schemaVersion: 1,
            canonicalJson: {
              type: "tiptap_doc",
              schemaVersion: 1,
              content: INITIAL_EDITOR_CONTENT,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Belge olusturulamadi (${response.status}).`);
        }

        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};
        const root = asRecord(payload);
        const createdId =
          readFirstString(root || {}, ["id", "documentId"]) ||
          readFirstString(asRecord(root?.item) || {}, ["id", "documentId"]);

        if (!createdId) {
          throw new Error("Belge olusturma yaniti gecersiz.");
        }

        router.push(`/editor/${createdId}`);
        return;
      }

      if (typeof window === "undefined") {
        router.push("/editor/new");
        return;
      }

      const nowIso = new Date().toISOString();
      const localId = `local-${Date.now().toString(36)}`;
      const title = `${templateLabel} ${new Date().toLocaleDateString("tr-TR")}`;
      const draftKey = `editor-unified:draft:${localId}`;

      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          canonical: {
            type: "tiptap_doc",
            schemaVersion: 1,
            content: INITIAL_EDITOR_CONTENT,
          },
          updatedAt: nowIso,
        }),
      );

      const existing = (() => {
        try {
          const raw = window.localStorage.getItem(LOCAL_DOCUMENT_INDEX_KEY);
          if (!raw) return [] as LocalDocumentRecord[];
          const parsed = JSON.parse(raw) as LocalDocumentRecord[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [] as LocalDocumentRecord[];
        }
      })();

      const nextIndex = [
        {
          id: localId,
          title,
          status: "DRAFT",
          type: documentType,
          updatedAt: nowIso,
          createdAt: nowIso,
        },
        ...existing.filter((item) => item.id !== localId),
      ].slice(0, MAX_LOCAL_INDEX_SIZE);

      window.localStorage.setItem(LOCAL_DOCUMENT_INDEX_KEY, JSON.stringify(nextIndex));
      router.push(`/editor/${localId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Yeni belge olusturulurken beklenmeyen hata olustu.";
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, router]);

  const showInitialEmpty = !isLoading && documents.length === 0 && !loadError;
  const showSearchEmpty = !isLoading && documents.length > 0 && filteredDocuments.length === 0;
  const quickTemplates = [
    {
      id: "blank",
      title: "Bos Belge",
      description: "Sifirdan temiz bir belge ile basla.",
      accent: "from-slate-900 to-slate-700",
      type: "PETITION",
    },
    {
      id: "petition",
      title: "Dilekce Taslagi",
      description: "Mahkeme odakli profesyonel giris yapisi.",
      accent: "from-blue-800 to-blue-600",
      type: "PETITION",
    },
    {
      id: "general",
      title: "Genel Taslak",
      description: "Hizli not, gorus veya rapor metni hazirla.",
      accent: "from-emerald-800 to-emerald-600",
      type: "PETITION",
    },
  ] as const;

  const renderDocumentCard = (item: DocumentListItem, className = "") => (
    <article key={item.id} className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.05)] ${className}`.trim()}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="line-clamp-2 font-medium text-slate-900">{item.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">ID: {item.id}</p>
        </div>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClass(item.status)}`}>
          {item.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <p>Son duzenleme: {formatDate(item.updatedAt)}</p>
        <p>Olusturma: {formatDate(item.createdAt)}</p>
        <p>Tip: {item.type || "-"}</p>
        <p>Kaynak: {item.source}</p>
      </div>
      <Link
        href={`/editor/${encodeURIComponent(item.id)}`}
        className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Belgeyi Ac
      </Link>
    </article>
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_34%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-4 py-8 md:px-8 md:py-10">
      <div className="pointer-events-none absolute -right-20 top-20 h-72 w-72 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-20 h-72 w-72 rounded-full bg-blue-200/20 blur-3xl" />

      <div className="relative mx-auto w-full max-w-7xl space-y-6">
        <section className="relative overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_24px_56px_rgba(15,23,42,0.09)] backdrop-blur md:p-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 opacity-[0.06]" />
          <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-2xl space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                Belgeler Workspace
              </span>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
                Belgelerini yonet, ara ve tek adimda duzenlemeye gec
              </h1>
              <p className="text-sm leading-6 text-slate-600 md:text-base">
                Microsoft Word ve Google Docs benzeri bir giris deneyimi ile belgelerine merkezi bir ekrandan eris.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    void createDocument({ templateLabel: "Belge", type: "PETITION" });
                  }}
                  disabled={isCreating}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                  Belge Olustur
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void loadDocuments({ silent: true });
                  }}
                  disabled={isRefreshing}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Yenile
                </button>
              </div>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[520px] xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <Files className="h-4 w-4" />
                </div>
                <p className="text-xs text-slate-500">Toplam Belge</p>
                <p className="text-xl font-semibold text-slate-900">{stats.total}</p>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <PencilLine className="h-4 w-4" />
                </div>
                <p className="text-xs text-blue-700/80">Taslak</p>
                <p className="text-xl font-semibold text-blue-900">{stats.draftCount}</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <p className="text-xs text-amber-700/80">Incelemede</p>
                <p className="text-xl font-semibold text-amber-900">{stats.reviewCount}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <p className="text-xs text-emerald-700/80">Final</p>
                <p className="text-xl font-semibold text-emerald-900">{stats.finalCount}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.06)] md:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative block flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Belge adi, durum, tip veya ID ara..."
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              />
            </label>

            <div className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${viewMode === "table" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                <Rows3 className="h-3.5 w-3.5" />
                Tablo
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${viewMode === "cards" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Kartlar
              </button>
            </div>

            <div className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Bugun guncellenen: {stats.updatedTodayCount}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition ${
                  statusFilter === option.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {createError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {createError}
            </div>
          ) : null}

          {loadError ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {loadError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {quickTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  void createDocument({ templateLabel: template.title, type: template.type });
                }}
                disabled={isCreating}
                className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                <div className={`mb-3 inline-flex h-8 items-center rounded-lg bg-gradient-to-r px-2.5 text-[11px] font-semibold text-white ${template.accent}`}>
                  Hazir Baslangic
                </div>
                <p className="text-sm font-semibold text-slate-900">{template.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{template.description}</p>
              </button>
            ))}
          </div>
        </section>

        {isLoading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Belgeler yukleniyor...
            </div>
          </section>
        ) : null}

        {!isLoading && documents.length === 0 && loadError ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Belgeler getirilemedi</h2>
            <p className="mt-1 text-sm text-slate-600">Lutfen baglantini kontrol et ve tekrar dene.</p>
            <button
              type="button"
              onClick={() => {
                void loadDocuments();
              }}
              className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Tekrar Dene
            </button>
          </section>
        ) : null}

        {showInitialEmpty ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <FileText className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Henuz belgen yok</h2>
            <p className="mt-1 text-sm text-slate-600">Ilk belgeni olusturarak duzenlemeye hemen baslayabilirsin.</p>
            <button
              type="button"
              onClick={() => {
                void createDocument({ templateLabel: "Belge", type: "PETITION" });
              }}
              disabled={isCreating}
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FilePlus2 className="h-4 w-4" />
              Ilk Belgeni Olustur
            </button>
          </section>
        ) : null}

        {showSearchEmpty ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
            <h2 className="text-lg font-semibold text-slate-900">Aramana uygun belge bulunamadi</h2>
            <p className="mt-1 text-sm text-slate-600">Arama metnini veya filtre secimini guncelleyebilirsin.</p>
          </section>
        ) : null}

        {!isLoading && filteredDocuments.length > 0 ? (
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
            {viewMode === "table" ? (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50/80">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Belge</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Son Duzenleme</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Olusturma</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Durum</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Tip</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kaynak</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Islem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDocuments.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/60">
                          <td className="px-5 py-4">
                            <p className="font-medium text-slate-900">{item.title}</p>
                            <p className="mt-0.5 text-xs text-slate-500">ID: {item.id}</p>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">{formatDate(item.updatedAt)}</td>
                          <td className="px-5 py-4 text-sm text-slate-700">{formatDate(item.createdAt)}</td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(item.status)}`}>
                              {item.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">{item.type || "-"}</td>
                          <td className="px-5 py-4 text-sm text-slate-700">{item.source}</td>
                          <td className="px-5 py-4 text-right">
                            <Link
                              href={`/editor/${encodeURIComponent(item.id)}`}
                              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Ac
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-3 p-4 md:hidden">
                  {filteredDocuments.map((item) => renderDocumentCard(item))}
                </div>
              </>
            ) : (
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredDocuments.map((item) => renderDocumentCard(item))}
              </div>
            )}
          </section>
        ) : null}

        {!isLoading && filteredDocuments.length > 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Toplam gorunen belge: {filteredDocuments.length}</span>
              <span className="inline-flex items-center gap-1">
                <Archive className="h-3.5 w-3.5" />
                Arsiv dahil tum kayitlar
              </span>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
