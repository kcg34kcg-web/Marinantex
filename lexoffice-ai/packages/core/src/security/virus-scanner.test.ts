import { afterEach, describe, expect, it } from "vitest";
import { createVirusScanner } from "./virus-scanner";

describe("createVirusScanner", () => {
  afterEach(() => {
    delete process.env.ATTACHMENT_SCANNER_DRIVER;
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
    delete process.env.ATTACHMENT_SCANNER_HTTP_ENDPOINT;
    delete process.env.ALLOW_HEURISTIC_SCANNER;
  });

  it("heuristic scanner EICAR imzasını infected döner", async () => {
    process.env.ATTACHMENT_SCANNER_DRIVER = "heuristic";

    const scanner = createVirusScanner();
    const result = await scanner.scan({
      tenantId: "tenant_1",
      attachmentId: "att_1",
      fileName: "test.txt",
      mimeType: "text/plain",
      content: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")
    });

    expect(result.status).toBe("INFECTED");
    expect(result.engine).toBe("heuristic");
  });

  it("heuristic scanner normal metni clean döner", async () => {
    process.env.ATTACHMENT_SCANNER_DRIVER = "heuristic";

    const scanner = createVirusScanner();
    const result = await scanner.scan({
      tenantId: "tenant_1",
      attachmentId: "att_2",
      fileName: "notlar.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("Merhaba dunya")
    });

    expect(result.status).toBe("CLEAN");
  });
});
