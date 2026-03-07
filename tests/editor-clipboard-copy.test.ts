import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { copyInternalUdfFragment } from "@/apps/web/lib/editor/clipboard/copyInternalUdfFragment";
import { copyUyapCompatible } from "@/apps/web/lib/editor/clipboard/copyUyapCompatible";
import { INTERNAL_UDF_FRAGMENT_MIME } from "@/apps/web/lib/editor/clipboard/types";

function createCopyEditor(): Editor {
  return {
    state: {
      selection: {
        from: 0,
        to: 0,
        empty: true,
      },
    },
    getJSON() {
      return {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Ilk satir\tIkinci satir" }],
          },
        ],
      };
    },
    getText() {
      return "Ilk satir\tIkinci satir";
    },
  } as unknown as Editor;
}

function installLegacyClipboardMocks() {
  const clipboardStore = new Map<string, string>();
  const listeners = new Map<string, Set<(event: ClipboardEvent) => void>>();

  const mockDocument = {
    body: {
      appendChild() {
        return undefined;
      },
    },
    createElement() {
      return {
        value: "",
        style: {},
        setAttribute() {
          return undefined;
        },
        focus() {
          return undefined;
        },
        select() {
          return undefined;
        },
        setSelectionRange() {
          return undefined;
        },
        remove() {
          return undefined;
        },
      };
    },
    addEventListener(type: string, callback: (event: ClipboardEvent) => void) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)?.add(callback);
    },
    removeEventListener(type: string, callback: (event: ClipboardEvent) => void) {
      listeners.get(type)?.delete(callback);
    },
    execCommand(command: string) {
      if (command !== "copy") {
        return false;
      }
      const copyListeners = Array.from(listeners.get("copy") ?? []);
      const event = {
        clipboardData: {
          setData(type: string, value: string) {
            clipboardStore.set(type, value);
          },
        },
        preventDefault() {
          return undefined;
        },
      } as unknown as ClipboardEvent;
      copyListeners.forEach((listener) => listener(event));
      return true;
    },
  };

  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: mockDocument,
  });

  return {
    clipboardStore,
    restore() {
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as Record<string, unknown>).navigator;
      }

      if (documentDescriptor) {
        Object.defineProperty(globalThis, "document", documentDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as Record<string, unknown>).document;
      }
    },
  };
}

const restorers: Array<() => void> = [];

afterEach(() => {
  while (restorers.length) {
    const restore = restorers.pop();
    restore?.();
  }
});

describe("Clipboard copy legacy fallback", () => {
  it("writes custom+html+plain payload for internal copy when Clipboard API is missing", async () => {
    const installed = installLegacyClipboardMocks();
    restorers.push(installed.restore);

    const result = await copyInternalUdfFragment(createCopyEditor());

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("rich");
    expect(installed.clipboardStore.get("text/plain")).toContain("Ilk satir");
    expect(installed.clipboardStore.get("text/html")).toContain(
      "data-marinantex-udf-fragment",
    );
    expect(installed.clipboardStore.get(INTERNAL_UDF_FRAGMENT_MIME)).toContain(
      "marinantex.udf-fragment",
    );
  });

  it("writes html+plain payload for UYAP copy when Clipboard API is missing", async () => {
    const installed = installLegacyClipboardMocks();
    restorers.push(installed.restore);

    const result = await copyUyapCompatible(createCopyEditor());

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("html");
    expect(installed.clipboardStore.get("text/plain")).toContain("Ilk satir");
    expect(installed.clipboardStore.get("text/html")).toContain("<div");
    expect(installed.clipboardStore.has(INTERNAL_UDF_FRAGMENT_MIME)).toBe(false);
  });
});
