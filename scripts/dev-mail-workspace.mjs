import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";

const MAIL_PORT = process.env.MAIL_WORKSPACE_PORT?.trim() || "3001";
const MAIL_DIST_DIR = process.env.MAIL_WORKSPACE_DIST_DIR?.trim() || ".next";
const MAIL_APP_DIR = path.resolve(process.cwd(), "lexoffice-ai/apps/web");
const NEXT_BIN = path.join(
  MAIL_APP_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);
const NEXT_BUILD_DIR = path.join(MAIL_APP_DIR, MAIL_DIST_DIR);
const NEXT_BUILD_MANIFEST_PATH = path.join(NEXT_BUILD_DIR, "build-manifest.json");
const NEXT_PAGES_MANIFEST_PATH = path.join(NEXT_BUILD_DIR, "server", "pages-manifest.json");
const MAIL_HEALTH_URL = process.env.MAIL_WORKSPACE_HEALTH_URL?.trim() || `http://localhost:${MAIL_PORT}/mail-workspace/sign-in`;

let childProcess = null;
let shuttingDown = false;
let keepAliveTimer = null;

function ensurePrerequisites() {
  if (!existsSync(MAIL_APP_DIR)) {
    throw new Error(`Mail workspace klasoru bulunamadi: ${MAIL_APP_DIR}`);
  }

  if (!existsSync(NEXT_BIN)) {
    throw new Error(
      `Mail workspace next binary bulunamadi: ${NEXT_BIN}. once \`corepack pnpm --dir lexoffice-ai install\` calistirin.`,
    );
  }
}

function safelyParseJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function shouldResetNextArtifacts() {
  if (!existsSync(NEXT_BUILD_MANIFEST_PATH) || !existsSync(NEXT_PAGES_MANIFEST_PATH)) {
    return false;
  }

  const buildManifest = safelyParseJson(NEXT_BUILD_MANIFEST_PATH);
  const pagesManifest = safelyParseJson(NEXT_PAGES_MANIFEST_PATH);

  if (!buildManifest || !pagesManifest) {
    return false;
  }

  const hasAppEntry = Boolean(buildManifest?.pages?.["/_app"]);
  const pagesManifestKeys = Object.keys(pagesManifest);

  // Known broken cache shape in dev: build-manifest expects "/_app" while pages-manifest is empty.
  return hasAppEntry && pagesManifestKeys.length === 0;
}

function resetBrokenNextArtifactsIfNeeded() {
  if (!existsSync(NEXT_BUILD_DIR)) {
    return;
  }

  // Never mutate dist artifacts while any process is already listening on the mail port.
  if (hasListeningProcessOnPort(MAIL_PORT)) {
    return;
  }

  if (!shouldResetNextArtifacts()) {
    return;
  }

  console.warn("[dev:mail] Bozuk .next cache tespit edildi (/_app). Cache temizleniyor...");
  rmSync(NEXT_BUILD_DIR, { recursive: true, force: true });
}

function hasListeningProcessOnPort(port) {
  const parsedPort = Number.parseInt(String(port), 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    return false;
  }

  if (process.platform === "win32") {
    try {
      const output = execSync("netstat -ano -p tcp", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const pattern = new RegExp(`:${parsedPort}\\s+.*LISTENING\\s+\\d+`, "i");
      return output.split(/\r?\n/).some((line) => pattern.test(line));
    } catch {
      return false;
    }
  }

  try {
    const output = execSync(`lsof -n -iTCP:${parsedPort} -sTCP:LISTEN -t`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some(Boolean);
  } catch {
    return false;
  }
}

async function isMailWorkspaceReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(MAIL_HEALTH_URL, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function holdProcessForExternalWorkspace() {
  if (keepAliveTimer) {
    return;
  }

  console.log(`[dev:mail] Mail workspace zaten aktif (port ${MAIL_PORT}). Mevcut surec kullaniliyor.`);
  keepAliveTimer = setInterval(() => {}, 60_000);
}

async function tryUseExistingWorkspaceOnPort() {
  if (!hasListeningProcessOnPort(MAIL_PORT)) {
    return false;
  }

  if (await isMailWorkspaceReachable()) {
    holdProcessForExternalWorkspace();
    return true;
  }

  console.error(
    `[dev:mail] Port ${MAIL_PORT} dolu fakat mail workspace dogrulanamadi. ` +
      `Portu kullanan sureci kapatip tekrar deneyin: lsof -ti tcp:${MAIL_PORT} | xargs kill`,
  );
  process.exit(1);
}

function startMailWorkspace() {
  childProcess = spawn(NEXT_BIN, ["dev", "-p", MAIL_PORT], {
    cwd: MAIL_APP_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_DIST_DIR: MAIL_DIST_DIR,
      NODE_ENV: process.env.NODE_ENV ?? "development",
    },
  });

  childProcess.on("exit", async (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;

    if (await tryUseExistingWorkspaceOnPort()) {
      return;
    }

    console.warn(`[dev:mail] Mail workspace kapandi (${detail}). 2 sn sonra yeniden baslatiliyor...`);
    setTimeout(startMailWorkspace, 2000);
  });
}

function gracefulStop(signalName) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[dev:mail] ${signalName} alindi. Mail workspace durduruluyor...`);

  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  if (childProcess && !childProcess.killed) {
    childProcess.kill("SIGTERM");
  }

  setTimeout(() => process.exit(0), 500);
}

async function main() {
  ensurePrerequisites();

  if (await tryUseExistingWorkspaceOnPort()) {
    return;
  }

  resetBrokenNextArtifactsIfNeeded();

  if (await tryUseExistingWorkspaceOnPort()) {
    return;
  }

  startMailWorkspace();
}

process.on("SIGINT", () => gracefulStop("SIGINT"));
process.on("SIGTERM", () => gracefulStop("SIGTERM"));

main().catch((error) => {
  console.error("[dev:mail] Baslatma hatasi:", error);
  process.exit(1);
});
