import type {
  CanonicalDocumentTree,
  ClauseItem,
  DocumentExportItem,
  DocumentStatus,
  DocumentSummary,
  ShareLinkItem,
  SharePermission,
  TemplateItem,
} from "@/components/editor/types";

interface ApiContext {
  apiBaseUrl: string;
  token: string;
  tenantId: string;
}

interface LockResponse {
  id: string;
  documentId: string;
  userId: string;
  acquiredAt: string;
  expiresAt: string;
  updatedAt: string;
}

interface PublicShareComment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

interface PublicSharePayload {
  shareLink: {
    id: string;
    permission: SharePermission;
    expiresAt: string;
    maxViews: number | null;
    viewCount: number;
    lastAccessedAt?: string | null;
  };
  document: {
    id: string;
    title: string;
    type: string;
    status: DocumentStatus;
    schemaVersion: number;
  };
  previewHtml: string;
  comments: PublicShareComment[];
}

function readApiContext(): ApiContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const token = window.localStorage.getItem("mx_access_token");
  const tenantId = window.localStorage.getItem("mx_tenant_id");
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:4000";

  if (!token || !tenantId) {
    return null;
  }

  return {
    apiBaseUrl,
    token,
    tenantId,
  };
}

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:4000";
}

async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const context = readApiContext();
  if (!context) {
    return null;
  }

  const response = await fetch(`${context.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${context.token}`,
      "x-tenant-id": context.tenantId,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function publicApiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Public API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function acquireDocumentLock(
  documentId: string,
): Promise<LockResponse | null> {
  return apiRequest<LockResponse>(`/documents/${documentId}/locks/acquire`, {
    method: "POST",
    body: JSON.stringify({
      leaseSeconds: 120,
    }),
  });
}

export async function refreshDocumentLock(
  documentId: string,
): Promise<LockResponse | null> {
  return apiRequest<LockResponse>(`/documents/${documentId}/locks/refresh`, {
    method: "POST",
    body: JSON.stringify({
      leaseSeconds: 120,
    }),
  });
}

export async function releaseDocumentLock(
  documentId: string,
): Promise<{ released: boolean } | null> {
  return apiRequest<{ released: boolean }>(
    `/documents/${documentId}/locks/release`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function autosaveDocument(
  documentId: string,
  canonicalTree: CanonicalDocumentTree,
  options?: { recoveredFromCrash?: boolean },
): Promise<{ latestVersion: number } | null> {
  return apiRequest<{ latestVersion: number }>(`/documents/${documentId}/autosave`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: canonicalTree.schemaVersion,
      canonicalJson: {
        type: canonicalTree.type,
        schemaVersion: canonicalTree.schemaVersion,
        content: canonicalTree.content,
      },
      recoveredFromCrash: Boolean(options?.recoveredFromCrash),
    }),
  });
}

export async function getDocument(
  documentId: string,
): Promise<DocumentSummary | null> {
  return apiRequest<DocumentSummary>(`/documents/${documentId}`, {
    method: "GET",
  });
}

export async function finalizeDocument(
  documentId: string,
): Promise<{ status: DocumentStatus } | null> {
  return apiRequest<{ status: DocumentStatus }>(`/documents/${documentId}/finalize`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function changeDocumentStatus(
  documentId: string,
  status: DocumentStatus,
): Promise<{ status: DocumentStatus } | null> {
  return apiRequest<{ status: DocumentStatus }>(`/documents/${documentId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function forkDraftFromFinal(
  documentId: string,
): Promise<DocumentSummary | null> {
  return apiRequest<DocumentSummary>(`/documents/${documentId}/fork-draft`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listTemplates(
  documentType?: TemplateItem["documentType"],
): Promise<TemplateItem[] | null> {
  const query = documentType ? `?documentType=${documentType}` : "";
  return apiRequest<TemplateItem[]>(`/templates${query}`, {
    method: "GET",
  });
}

export async function listClauses(
  category?: ClauseItem["category"],
): Promise<ClauseItem[] | null> {
  const query = category ? `?category=${category}` : "";
  return apiRequest<ClauseItem[]>(`/clauses${query}`, {
    method: "GET",
  });
}

export async function fetchPrintPreview(
  documentId: string,
): Promise<{ html: string; generatedAtIso: string } | null> {
  return apiRequest<{ html: string; generatedAtIso: string }>(
    `/documents/${documentId}/print-preview`,
    {
      method: "GET",
    },
  );
}

export async function requestPdfExport(
  documentId: string,
): Promise<DocumentExportItem | null> {
  return apiRequest<DocumentExportItem>(`/documents/${documentId}/exports/pdf`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function requestDocxExport(
  documentId: string,
): Promise<DocumentExportItem | null> {
  return apiRequest<DocumentExportItem>(`/documents/${documentId}/exports/docx`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listDocumentExports(
  documentId: string,
): Promise<DocumentExportItem[] | null> {
  return apiRequest<DocumentExportItem[]>(`/documents/${documentId}/exports`, {
    method: "GET",
  });
}

export async function issueExportSignedUrl(
  documentId: string,
  exportId: string,
): Promise<{ signedUrl: string; expiresInSeconds: number } | null> {
  return apiRequest<{ signedUrl: string; expiresInSeconds: number }>(
    `/documents/${documentId}/exports/${exportId}/signed-url`,
    {
      method: "GET",
    },
  );
}

export async function markExportDownloaded(
  documentId: string,
  exportId: string,
): Promise<{ recorded: boolean } | null> {
  return apiRequest<{ recorded: boolean }>(
    `/documents/${documentId}/exports/${exportId}/downloaded`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function createShareLink(
  documentId: string,
  permission: SharePermission,
  expiresInHours = 72,
  maxViews?: number,
): Promise<(ShareLinkItem & { token: string; publicUrl: string }) | null> {
  return apiRequest<ShareLinkItem & { token: string; publicUrl: string }>(
    `/documents/${documentId}/share-links`,
    {
      method: "POST",
      body: JSON.stringify({
        permission,
        expiresInHours,
        maxViews,
      }),
    },
  );
}

export async function listShareLinks(
  documentId: string,
): Promise<ShareLinkItem[] | null> {
  return apiRequest<ShareLinkItem[]>(`/documents/${documentId}/share-links`, {
    method: "GET",
  });
}

export async function revokeShareLink(
  documentId: string,
  shareLinkId: string,
): Promise<{ revoked: boolean } | null> {
  return apiRequest<{ revoked: boolean }>(
    `/documents/${documentId}/share-links/${shareLinkId}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function resolvePublicShare(
  token: string,
): Promise<PublicSharePayload> {
  return publicApiRequest<PublicSharePayload>(`/share-links/public/${token}`, {
    method: "GET",
  });
}

export async function createPublicShareComment(
  token: string,
  input: { authorName: string; body: string },
): Promise<PublicShareComment> {
  return publicApiRequest<PublicShareComment>(`/share-links/public/${token}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
