import type { CanonicalDocumentTree } from "@/components/editor/types";

const DB_NAME = "marinantex-editor-db";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

export interface EditorDraftRecord {
  documentId: string;
  canonicalTree: CanonicalDocumentTree;
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, mode);
  const store = tx.objectStore(STORE_NAME);
  try {
    return await run(store);
  } finally {
    db.close();
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function saveDraft(record: EditorDraftRecord): Promise<void> {
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.put(record));
  });
}

export async function loadDraft(
  documentId: string,
): Promise<EditorDraftRecord | null> {
  return withStore("readonly", async (store) => {
    const value = await requestToPromise<EditorDraftRecord | undefined>(
      store.get(documentId),
    );
    return value ?? null;
  });
}

export async function deleteDraft(documentId: string): Promise<void> {
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.delete(documentId));
  });
}
