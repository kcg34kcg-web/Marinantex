import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AttachmentObjectStore,
  decodeAttachmentStorageLocator,
  encodeAttachmentStorageLocator,
  resetAttachmentLocalEncryptionCacheForTests
} from "./attachment-object-store";

describe("AttachmentObjectStore (local)", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lexoffice-attachments-"));
    process.env.ATTACHMENT_STORAGE_DRIVER = "local";
    resetAttachmentLocalEncryptionCacheForTests();
  });

  afterEach(async () => {
    delete process.env.ATTACHMENT_STORAGE_DRIVER;
    delete process.env.ATTACHMENT_LOCAL_ENCRYPTION;
    delete process.env.ATTACHMENT_LOCAL_ENCRYPTION_KEY;
    resetAttachmentLocalEncryptionCacheForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("write/read/move/delete akışını çalıştırır", async () => {
    const store = new AttachmentObjectStore(tempRoot);
    const source = encodeAttachmentStorageLocator("quarantine", "tenant/abc/staging/file.txt");
    const target = encodeAttachmentStorageLocator("clean", "tenant/abc/final/file.txt");

    await store.write(source, Buffer.from("merhaba"), "text/plain");
    expect(await store.exists(source)).toBe(true);

    const readBack = await store.read(source);
    expect(readBack.toString("utf8")).toBe("merhaba");

    await store.move(source, target, "text/plain");
    expect(await store.exists(source)).toBe(false);
    expect(await store.exists(target)).toBe(true);

    await store.delete(target);
    expect(await store.exists(target)).toBe(false);
  });

  it("locator encode/decode zone ve key bilgisini korur", () => {
    const encoded = encodeAttachmentStorageLocator("quarantine", "/tenant/a/b/c.txt");
    const decoded = decodeAttachmentStorageLocator(encoded);

    expect(decoded.zone).toBe("quarantine");
    expect(decoded.key).toBe("tenant/a/b/c.txt");
  });

  it("local encryption etkinse dosyayi sifreli yazar ve geri cozer", async () => {
    process.env.ATTACHMENT_LOCAL_ENCRYPTION = "true";
    process.env.ATTACHMENT_LOCAL_ENCRYPTION_KEY = "unit-test-local-encryption-key";
    resetAttachmentLocalEncryptionCacheForTests();

    const store = new AttachmentObjectStore(tempRoot);
    const locator = encodeAttachmentStorageLocator("quarantine", "tenant/abc/staging/secret.txt");
    const rawText = "gizli içerik";

    await store.write(locator, Buffer.from(rawText, "utf8"), "text/plain");

    const physicalPath = path.join(tempRoot, "quarantine", "tenant/abc/staging/secret.txt");
    const diskContent = await readFile(physicalPath);
    expect(diskContent.toString("utf8")).not.toContain(rawText);
    expect(diskContent.subarray(0, 6).toString("utf8")).toBe("LOENC1");

    const readBack = await store.read(locator);
    expect(readBack.toString("utf8")).toBe(rawText);
  });
});
