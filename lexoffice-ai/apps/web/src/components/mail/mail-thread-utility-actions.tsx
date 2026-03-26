"use client";

import { useState } from "react";

export function MailThreadUtilityActions({ subject }: { subject: string }) {
  const [hint, setHint] = useState<string | null>(null);

  function openInNewWindow(): void {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  }

  function printThread(): void {
    setHint(null);
    window.print();
  }

  function exportPdf(): void {
    setHint("Yazdır penceresinde hedef olarak 'PDF olarak kaydet' seçin.");
    window.print();
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={openInNewWindow}
        >
          Yeni Pencere
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={printThread}
        >
          Yazdır
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={exportPdf}
        >
          PDF Dışa Aktar
        </button>
      </div>
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
      <p className="truncate text-[11px] text-slate-400">{subject}</p>
    </div>
  );
}
