"use client";

import { useRef, useState } from "react";

export function AttachmentUploader({ onSelect }: { onSelect: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function mergeFiles(incoming: FileList | null): void {
    onSelect(Array.from(incoming ?? []));
  }

  return (
    <div
      className={`rounded-lg border border-dashed p-3 transition ${
        dragActive ? "border-blue-400 bg-blue-50/70" : "border-slate-300"
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => {
        setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        mergeFiles(event.dataTransfer.files);
      }}
    >
      <p className="text-xs text-slate-600">Sürükle bırak veya dosya seç</p>
      <button
        type="button"
        className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs"
        onClick={() => inputRef.current?.click()}
      >
        Dosya Seç
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => mergeFiles(event.target.files)}
      />
    </div>
  );
}
