const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DEFAULT_BACKEND_URLS = ['http://127.0.0.1:8000', 'http://127.0.0.1:8001'] as const;

function normalizeBackendUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

function parseBackendUrlList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => normalizeBackendUrl(entry))
    .filter((entry): entry is string => typeof entry === 'string');
}

function isLocalBackend(urlValue: string): boolean {
  try {
    const parsed = new URL(urlValue);
    return LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function localSiblingPort(urlValue: string): string | null {
  try {
    const parsed = new URL(urlValue);
    if (!LOCAL_HOSTS.has(parsed.hostname)) return null;

    const currentPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (currentPort === '8000') {
      parsed.port = '8001';
      return parsed.origin;
    }
    if (currentPort === '8001') {
      parsed.port = '8000';
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveRagBackendCandidates(): string[] {
  const explicitList = parseBackendUrlList(process.env.RAG_BACKEND_URLS);
  if (explicitList.length > 0) {
    return [...new Set(explicitList)];
  }

  const single = normalizeBackendUrl(process.env.RAG_BACKEND_URL);
  if (single) {
    const candidates = [single];
    const sibling = localSiblingPort(single);
    if (sibling) {
      candidates.push(sibling);
    }
    return [...new Set(candidates)];
  }

  return [...DEFAULT_BACKEND_URLS];
}

export async function fetchRagBackend(path: string, init: RequestInit): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const candidates = resolveRagBackendCandidates();
  let lastError: unknown = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const baseUrl = candidates[i];
    try {
      return await fetch(`${baseUrl}${normalizedPath}`, init);
    } catch (error) {
      lastError = error;
      if (i === candidates.length - 1) {
        break;
      }
    }
  }

  const attempted = candidates.join(', ');
  const reason = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(`RAG backend baglantisi kurulamadi. Denenen adresler: ${attempted}. Sebep: ${reason}`);
}

export function getRagBackendForLogs(): string[] {
  return resolveRagBackendCandidates();
}
