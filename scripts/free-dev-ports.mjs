import { execSync } from "node:child_process";

const DEFAULT_PORTS = [3000, 4000, 8000];
const isWindows = process.platform === "win32";

function readPorts() {
  const raw = process.env.DEV_PORTS?.trim();
  if (!raw) return DEFAULT_PORTS;
  const parsed = raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0 && value < 65536);
  return parsed.length ? Array.from(new Set(parsed)) : DEFAULT_PORTS;
}

function findListeningPidsWindows(ports) {
  let output = "";
  try {
    output = execSync("netstat -ano -p tcp", { encoding: "utf8" });
  } catch (error) {
    output = error instanceof Error && "stdout" in error ? String(error.stdout ?? "") : "";
  }

  const portSet = new Set(ports.map((port) => String(port)));
  const pids = new Set();
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("TCP")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const localAddress = parts[1] ?? "";
    const state = (parts[3] ?? "").toUpperCase();
    const pidText = parts[4] ?? "";
    if (state !== "LISTENING") continue;

    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch) continue;
    if (!portSet.has(portMatch[1])) continue;

    const pid = Number.parseInt(pidText, 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  return Array.from(pids);
}

function findListeningPidsUnix(ports) {
  const pids = new Set();

  for (const port of ports) {
    try {
      const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((pidText) => {
          const pid = Number.parseInt(pidText, 10);
          if (Number.isInteger(pid) && pid > 0) pids.add(pid);
        });
    } catch {
      // no process listening on this port or lsof unavailable
    }
  }

  return Array.from(pids);
}

function killPidWindows(pid) {
  execSync(`taskkill /PID ${pid} /F /T`, {
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function killPidUnix(pid) {
  process.kill(pid, "SIGTERM");
}

function main() {
  const ports = readPorts();
  const pids = isWindows
    ? findListeningPidsWindows(ports)
    : findListeningPidsUnix(ports);

  if (!pids.length) {
    console.log(`[dev:free-ports] No listeners found on ports: ${ports.join(", ")}`);
    return;
  }

  console.log(
    `[dev:free-ports] Releasing ports ${ports.join(", ")} by stopping PIDs: ${pids.join(", ")}`,
  );

  for (const pid of pids) {
    try {
      if (isWindows) {
        killPidWindows(pid);
      } else {
        killPidUnix(pid);
      }
      console.log(`[dev:free-ports] Stopped PID ${pid}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dev:free-ports] Could not stop PID ${pid}: ${message}`);
    }
  }
}

main();
