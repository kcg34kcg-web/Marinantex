"use client";

import { useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";

type ThreadProductivity = {
  isPinned: boolean;
  pinnedAt: string | null;
  readLaterAt: string | null;
  reminderAt: string | null;
  note: string | null;
};

export function MailThreadProductivityPanel({
  tenantId,
  threadId,
  initialProductivity
}: {
  tenantId: string;
  threadId: string;
  initialProductivity: ThreadProductivity;
}) {
  const [isPinned, setIsPinned] = useState(initialProductivity.isPinned);
  const [readLaterAt, setReadLaterAt] = useState(toLocalDateTimeInput(initialProductivity.readLaterAt));
  const [reminderAt, setReminderAt] = useState(toLocalDateTimeInput(initialProductivity.reminderAt));
  const [note, setNote] = useState(initialProductivity.note ?? "");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const readLaterHint = useMemo(() => {
    if (!readLaterAt) {
      return "Ayarli degil";
    }
    return new Date(readLaterAt).toLocaleString("tr-TR");
  }, [readLaterAt]);

  async function save(): Promise<void> {
    setPending(true);
    setStatus(null);

    const response = await fetch(withBasePath(`/api/v1/mail/threads/${threadId}/productivity`), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        isPinned,
        readLaterAt: readLaterAt.length > 0 ? new Date(readLaterAt).toISOString() : null,
        reminderAt: reminderAt.length > 0 ? new Date(reminderAt).toISOString() : null,
        note: note.trim().length > 0 ? note.trim() : null
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setPending(false);
      setStatus(payload.error?.message ?? "Kayit basarisiz");
      return;
    }

    setPending(false);
    setStatus("Kaydedildi");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Verimlilik</h3>
      <div className="mt-3 space-y-3 text-xs">
        <label className="flex items-center gap-2 text-slate-700">
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(event) => setIsPinned(event.target.checked)}
          />
          Pinle
        </label>

        <div className="space-y-1">
          <p className="text-slate-600">Sonra Oku</p>
          <input
            type="datetime-local"
            value={readLaterAt}
            onChange={(event) => setReadLaterAt(event.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1"
              onClick={() => {
                setReadLaterAt(toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
              }}
            >
              +24 saat
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1"
              onClick={() => {
                setReadLaterAt("");
              }}
            >
              Temizle
            </button>
          </div>
          <p className="text-slate-500">Durum: {readLaterHint}</p>
        </div>

        <div className="space-y-1">
          <p className="text-slate-600">Hatirlatma</p>
          <input
            type="datetime-local"
            value={reminderAt}
            onChange={(event) => setReminderAt(event.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1"
            onClick={() => {
              setReminderAt("");
            }}
          >
            Hatirlatmayi Temizle
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-slate-600">Not</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={2000}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder="Bu thread icin kisa not..."
          />
        </label>

        <button
          type="button"
          disabled={pending}
          className="rounded border border-slate-300 px-2 py-1 disabled:opacity-60"
          onClick={() => {
            void save();
          }}
        >
          {pending ? "Kaydediliyor..." : "Kaydet"}
        </button>
        {status ? <p className="text-slate-600">{status}</p> : null}
      </div>
    </section>
  );
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
