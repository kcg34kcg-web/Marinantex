const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DEFAULT_BACKEND_URLS = ['http://127.0.0.1:8000', 'http://127.0.0.1:8001'] as const;

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

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

function shouldTryNextCandidate(
  response: Response,
  params: {
    baseUrl: string;
    normalizedPath: string;
    candidateIndex: number;
    candidateCount: number;
  },
): boolean {
  const { baseUrl, normalizedPath, candidateIndex, candidateCount } = params;
  if (candidateIndex >= candidateCount - 1) return false;

  if (response.status >= 500) return true;

  // Local gelistirmede ilk aday bazen ayakta ama RAG route'u olmayan farkli bir servisi isaret eder.
  if (
    isLocalBackend(baseUrl)
    && normalizedPath.startsWith('/api/v1/rag-v3/')
    && (response.status === 404 || response.status === 405)
  ) {
    return true;
  }

  return false;
}

export async function fetchRagBackend(path: string, init: RequestInit): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const candidates = resolveRagBackendCandidates();
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const baseUrl = candidates[i];
    if (init.signal?.aborted) {
      lastError = init.signal.reason ?? new Error('RAG backend istegi iptal edildi.');
      break;
    }
    try {
      const response = await fetch(`${baseUrl}${normalizedPath}`, init);
      if (shouldTryNextCandidate(response, {
        baseUrl,
        normalizedPath,
        candidateIndex: i,
        candidateCount: candidates.length,
      })) {
        lastResponse = response;
        if (init.signal?.aborted) {
          break;
        }
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (isAbortLikeError(error)) {
        break;
      }
      if (i === candidates.length - 1) {
        break;
      }
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  const attempted = candidates.join(', ');
  const reason = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(`RAG backend baglantisi kurulamadi. Denenen adresler: ${attempted}. Sebep: ${reason}`);
}

export function getRagBackendForLogs(): string[] {
  return resolveRagBackendCandidates();
}
