import net from "node:net";

export type VirusScanRequest = {
  tenantId: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
};

export type VirusScanResult = {
  status: "CLEAN" | "INFECTED";
  engine: string;
  signature?: string;
  details?: string;
};

export interface VirusScanner {
  scan(input: VirusScanRequest): Promise<VirusScanResult>;
}

type ScannerDriver = "heuristic" | "clamav" | "http";

const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "js",
  "jse",
  "vbs",
  "ps1",
  "jar",
  "scr"
]);

class HeuristicVirusScanner implements VirusScanner {
  async scan(input: VirusScanRequest): Promise<VirusScanResult> {
    const extension = input.fileName.split(".").at(-1)?.toLowerCase();
    if (extension && BLOCKED_EXTENSIONS.has(extension)) {
      return {
        status: "INFECTED",
        engine: "heuristic",
        signature: "blocked-extension",
        details: `Policy blocked extension: .${extension}`
      };
    }

    const chunk = input.content.subarray(0, Math.min(input.content.byteLength, 8_192)).toString("utf8");
    if (chunk.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      return {
        status: "INFECTED",
        engine: "heuristic",
        signature: "eicar-test-file",
        details: "EICAR signature bulundu"
      };
    }

    return {
      status: "CLEAN",
      engine: "heuristic"
    };
  }
}

class ClamAvVirusScanner implements VirusScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number
  ) {}

  async scan(input: VirusScanRequest): Promise<VirusScanResult> {
    const response = await this.scanInstream(input.content);
    const parsed = parseClamAvResponse(response);

    return {
      status: parsed.status,
      engine: "clamav",
      ...(parsed.signature ? { signature: parsed.signature } : {}),
      details: response
    };
  }

  private async scanInstream(content: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port
      });

      let response = "";

      const timeout = setTimeout(() => {
        socket.destroy(new Error("ClamAV INSTREAM timeout"));
      }, this.timeoutMs);

      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("utf8");
      });

      socket.on("connect", () => {
        socket.write("zINSTREAM\0");

        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < content.length; offset += chunkSize) {
          const chunk = content.subarray(offset, offset + chunkSize);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length, 0);
          socket.write(header);
          socket.write(chunk);
        }

        const terminator = Buffer.alloc(4);
        terminator.writeUInt32BE(0, 0);
        socket.write(terminator);
        socket.end();
      });

      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      socket.on("close", (hadError) => {
        clearTimeout(timeout);
        if (hadError) {
          return;
        }

        if (response.trim().length === 0) {
          reject(new Error("ClamAV yanıtı boş"));
          return;
        }

        resolve(response.trim());
      });
    });
  }
}

class HttpVirusScanner implements VirusScanner {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly apiKey?: string
  ) {}

  async scan(input: VirusScanRequest): Promise<VirusScanResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Lexoffice-File-Name": encodeURIComponent(input.fileName),
          "X-Lexoffice-Mime-Type": input.mimeType,
          "X-Lexoffice-Tenant-Id": input.tenantId,
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: new Uint8Array(input.content),
        signal: controller.signal
      });

      if (!response.ok) {
        const bodyText = (await response.text()).slice(0, 300);
        throw new Error(`HTTP scanner başarısız (${response.status}): ${bodyText}`);
      }

      const payload = (await response.json()) as {
        status?: string;
        infected?: boolean;
        signature?: string;
        engine?: string;
        details?: string;
      };

      const status = normalizeHttpStatus(payload.status, payload.infected);
      if (!status) {
        throw new Error("HTTP scanner yanıtı geçersiz");
      }

      return {
        status,
        engine: payload.engine ?? "http-scanner",
        ...(payload.signature ? { signature: payload.signature } : {}),
        ...(payload.details ? { details: payload.details } : {})
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createVirusScanner(): VirusScanner {
  const driver = resolveScannerDriver();

  if (driver === "clamav") {
    const host = process.env.CLAMAV_HOST ?? "localhost";
    const portRaw = Number(process.env.CLAMAV_PORT ?? 3310);
    const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS ?? 20_000);

    return new ClamAvVirusScanner(host, Number.isFinite(portRaw) ? portRaw : 3310, timeoutMs);
  }

  if (driver === "http") {
    const endpoint = process.env.ATTACHMENT_SCANNER_HTTP_ENDPOINT;
    if (!endpoint || endpoint.trim().length === 0) {
      throw new Error("ATTACHMENT_SCANNER_HTTP_ENDPOINT tanımlı değil");
    }

    const timeoutMs = Number(process.env.ATTACHMENT_SCANNER_HTTP_TIMEOUT_MS ?? 20_000);
    return new HttpVirusScanner(endpoint, timeoutMs, process.env.ATTACHMENT_SCANNER_HTTP_API_KEY);
  }

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_HEURISTIC_SCANNER !== "true") {
    throw new Error(
      "Production ortamında heuristic scanner kapalıdır. ATTACHMENT_SCANNER_DRIVER=clamav veya http kullanılmalı."
    );
  }

  return new HeuristicVirusScanner();
}

function resolveScannerDriver(): ScannerDriver {
  const configured = process.env.ATTACHMENT_SCANNER_DRIVER?.trim().toLowerCase();
  if (configured === "heuristic" || configured === "clamav" || configured === "http") {
    return configured;
  }

  if (hasValue(process.env.CLAMAV_HOST) || hasValue(process.env.CLAMAV_PORT)) {
    return "clamav";
  }

  if (hasValue(process.env.ATTACHMENT_SCANNER_HTTP_ENDPOINT)) {
    return "http";
  }

  return "heuristic";
}

function parseClamAvResponse(value: string): { status: "CLEAN" | "INFECTED"; signature?: string } {
  const cleanMatch = value.match(/:\s+OK$/i);
  if (cleanMatch) {
    return { status: "CLEAN" };
  }

  const infectedMatch = value.match(/:\s+(.+)\s+FOUND$/i);
  if (infectedMatch) {
    const signature = infectedMatch[1]?.trim();
    return {
      status: "INFECTED",
      ...(signature ? { signature } : {})
    };
  }

  throw new Error(`ClamAV yanıtı çözümlenemedi: ${value}`);
}

function normalizeHttpStatus(status: string | undefined, infected: boolean | undefined): "CLEAN" | "INFECTED" | null {
  if (typeof infected === "boolean") {
    return infected ? "INFECTED" : "CLEAN";
  }

  if (!status) {
    return null;
  }

  const normalized = status.trim().toUpperCase();
  if (normalized === "CLEAN" || normalized === "OK" || normalized === "SAFE") {
    return "CLEAN";
  }

  if (normalized === "INFECTED" || normalized === "MALICIOUS" || normalized === "THREAT") {
    return "INFECTED";
  }

  return null;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
