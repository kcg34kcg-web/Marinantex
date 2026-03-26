import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MAIL_PORT = process.env.MAIL_WORKSPACE_PORT?.trim() || "3001";
const MAIL_APP_DIR = path.resolve(process.cwd(), "lexoffice-ai/apps/web");
const NEXT_BIN = path.join(
  MAIL_APP_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);

let childProcess = null;
let shuttingDown = false;

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

function startMailWorkspace() {
  childProcess = spawn(NEXT_BIN, ["dev", "-p", MAIL_PORT], {
    cwd: MAIL_APP_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? "development",
    },
  });

  childProcess.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
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

  if (childProcess && !childProcess.killed) {
    childProcess.kill("SIGTERM");
  }

  setTimeout(() => process.exit(0), 500);
}

function main() {
  ensurePrerequisites();
  startMailWorkspace();
}

process.on("SIGINT", () => gracefulStop("SIGINT"));
process.on("SIGTERM", () => gracefulStop("SIGTERM"));

main();
