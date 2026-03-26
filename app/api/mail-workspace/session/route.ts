import { spawn } from 'node:child_process';
import { createClient } from '@/utils/supabase/server';

const DEFAULT_MAIL_WORKSPACE_LOGIN_EMAIL = 'owner@demo.lexoffice.ai';
const DEFAULT_MAIL_WORKSPACE_LOGIN_PASSWORD = 'ChangeMe123!';
const DEFAULT_MAIL_WORKSPACE_TENANT_SLUG = 'demo-hukuk';
const DEFAULT_MAIL_WORKSPACE_PROXY_TARGET = 'http://localhost:3001';

const MAIL_WORKSPACE_LOGIN_PATH = '/mail-workspace/api/v1/auth/login';
const MAIL_WORKSPACE_HEALTH_PATH = '/mail-workspace/sign-in';
const MAIL_WORKSPACE_START_TIMEOUT_MS = 20000;
const MAIL_WORKSPACE_START_POLL_MS = 800;
const MAIL_WORKSPACE_REQUEST_TIMEOUT_MS = 5000;

type MailWorkspaceBootstrapStore = {
  startPromise?: Promise<boolean>;
};

const globalForMailWorkspaceBootstrap = globalThis as typeof globalThis & {
  __mailWorkspaceBootstrapStore?: MailWorkspaceBootstrapStore;
};

function getBootstrapStore(): MailWorkspaceBootstrapStore {
  if (!globalForMailWorkspaceBootstrap.__mailWorkspaceBootstrapStore) {
    globalForMailWorkspaceBootstrap.__mailWorkspaceBootstrapStore = {};
  }
  return globalForMailWorkspaceBootstrap.__mailWorkspaceBootstrapStore;
}

function getProxyTarget(): string {
  const target =
    process.env.MAIL_WORKSPACE_PROXY_TARGET?.trim() ||
    process.env.MAIL_WORKSPACE_URL?.trim() ||
    DEFAULT_MAIL_WORKSPACE_PROXY_TARGET;
  return target.replace(/\/$/, '');
}

function getLoginEndpoint(proxyTarget: string): string {
  return `${proxyTarget}${MAIL_WORKSPACE_LOGIN_PATH}`;
}

function getHealthEndpoint(proxyTarget: string): string {
  return `${proxyTarget}${MAIL_WORKSPACE_HEALTH_PATH}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function isWorkspaceReachable(proxyTarget: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      getHealthEndpoint(proxyTarget),
      {
        method: 'GET',
        redirect: 'manual',
      },
      2000,
    );
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

function startMailWorkspaceDevProcess(): boolean {
  try {
    const child = spawn('npm', ['run', 'dev:mail'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function ensureWorkspaceReady(proxyTarget: string): Promise<boolean> {
  if (await isWorkspaceReachable(proxyTarget)) {
    return true;
  }

  if (process.env.NODE_ENV !== 'development') {
    return false;
  }

  const autoStart = (process.env.MAIL_WORKSPACE_AUTO_START ?? 'true').toLowerCase();
  if (autoStart === 'false' || autoStart === '0') {
    return false;
  }

  const store = getBootstrapStore();
  if (!store.startPromise) {
    store.startPromise = (async () => {
      const started = startMailWorkspaceDevProcess();
      if (!started) {
        return false;
      }

      const deadline = Date.now() + MAIL_WORKSPACE_START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await isWorkspaceReachable(proxyTarget)) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, MAIL_WORKSPACE_START_POLL_MS));
      }

      return false;
    })().finally(() => {
      store.startPromise = undefined;
    });
  }

  return store.startPromise;
}

function extractSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    return setCookies;
  }

  const setCookie = response.headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Ana uygulama oturumu bulunamadi.' }, { status: 401 });
  }

  const email = process.env.MAIL_WORKSPACE_LOGIN_EMAIL?.trim() || DEFAULT_MAIL_WORKSPACE_LOGIN_EMAIL;
  const password = process.env.MAIL_WORKSPACE_LOGIN_PASSWORD?.trim() || DEFAULT_MAIL_WORKSPACE_LOGIN_PASSWORD;
  const tenantSlug = process.env.MAIL_WORKSPACE_TENANT_SLUG?.trim() || DEFAULT_MAIL_WORKSPACE_TENANT_SLUG;
  const proxyTarget = getProxyTarget();

  const ready = await ensureWorkspaceReady(proxyTarget);
  if (!ready) {
    return Response.json(
      { error: 'Mail workspace servisine ulasilamadi. `npm run dev` komutu ile tum servisleri birlikte acin.' },
      { status: 502 },
    );
  }

  let upstream: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      upstream = await fetchWithTimeout(
        getLoginEndpoint(proxyTarget),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            tenantSlug,
          }),
        },
        MAIL_WORKSPACE_REQUEST_TIMEOUT_MS,
      );
      break;
    } catch {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }

  if (!upstream) {
    return Response.json(
      { error: 'Mail workspace servisine ulasilamadi. Lutfen `npm run dev` ile yeniden deneyin.' },
      { status: 502 },
    );
  }

  const setCookies = extractSetCookies(upstream);
  if (!upstream.ok || setCookies.length === 0) {
    const payload = (await upstream.json().catch(() => null)) as
      | { error?: { message?: string } | string; message?: string }
      | null;

    const message =
      (typeof payload?.error === 'string' ? payload.error : payload?.error?.message) ||
      payload?.message ||
      (setCookies.length === 0 && upstream.ok
        ? 'Mail workspace oturum cerezini donmedi. Servisi yeniden baslatin.'
        : 'Mail workspace oturumu baslatilamadi.');

    return Response.json({ error: message }, { status: 502 });
  }

  const response = Response.json({ ok: true });
  for (const cookie of setCookies) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}
