"use client";

import { useEffect, useState } from "react";

type CalendarMessageInput = {
  subject: string | null;
  bodyText: string | null;
  snippet: string | null;
  fromName: string | null;
  fromEmail: string | null;
};

export function MailThreadCalendarPanel({
  threadSubject,
  latestMessage
}: {
  threadSubject: string | null;
  latestMessage: CalendarMessageInput | null;
}) {
  const [startAtLocal, setStartAtLocal] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const extracted = extractDateFromText(
      [latestMessage?.subject, latestMessage?.bodyText, latestMessage?.snippet]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .join("\n")
    );
    const fallback = new Date();
    fallback.setMinutes(0, 0, 0);
    fallback.setHours(fallback.getHours() + 1);
    setStartAtLocal(toDateTimeLocalValue(extracted ?? fallback));
  }, [latestMessage?.bodyText, latestMessage?.snippet, latestMessage?.subject]);

  function openGoogleCalendar(): void {
    const startDate = parseLocalDateTime(startAtLocal);
    if (!startDate) {
      setStatus("Geçerli başlangıç tarihi seçin.");
      return;
    }

    const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
    const title = threadSubject?.trim() || latestMessage?.subject?.trim() || "Mail Toplantısı";
    const details = buildEventDetails(latestMessage);
    const dates = `${toCalendarDateUtc(startDate)}/${toCalendarDateUtc(endDate)}`;

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates,
      details
    });

    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank", "noopener");
    setStatus("Google Takvim penceresi açıldı.");
  }

  function downloadIcs(): void {
    const startDate = parseLocalDateTime(startAtLocal);
    if (!startDate) {
      setStatus("Geçerli başlangıç tarihi seçin.");
      return;
    }

    const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
    const title = threadSubject?.trim() || latestMessage?.subject?.trim() || "Mail Toplantısı";
    const details = buildEventDetails(latestMessage);
    const now = new Date();

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//LexOffice AI//Mail Calendar Integration//TR",
      "BEGIN:VEVENT",
      `UID:${createEventUid()}@lexoffice-ai.local`,
      `DTSTAMP:${toCalendarDateUtc(now)}`,
      `DTSTART:${toCalendarDateUtc(startDate)}`,
      `DTEND:${toCalendarDateUtc(endDate)}`,
      `SUMMARY:${escapeIcsText(title)}`,
      `DESCRIPTION:${escapeIcsText(details)}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mail-toplanti.ics";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    setStatus("ICS dosyası indirildi.");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Takvim Entegrasyonu</h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          Aktif
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Mail içeriğindeki tarih/saatten öneri alıp Google Takvim veya ICS ile toplantı oluşturabilirsiniz.
      </p>

      <div className="mt-3 space-y-2">
        <label className="block text-xs text-slate-600">
          Başlangıç
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            value={startAtLocal}
            onChange={(event) => setStartAtLocal(event.target.value)}
          />
        </label>

        <label className="block text-xs text-slate-600">
          Süre (dk)
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            value={durationMinutes}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) {
                setDurationMinutes(value);
              }
            }}
          >
            <option value={15}>15 dakika</option>
            <option value={30}>30 dakika</option>
            <option value={45}>45 dakika</option>
            <option value={60}>60 dakika</option>
            <option value={90}>90 dakika</option>
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
            onClick={openGoogleCalendar}
          >
            Google Takvimde Aç
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
            onClick={downloadIcs}
          >
            ICS İndir
          </button>
        </div>
      </div>

      {status ? <p className="mt-2 text-xs text-slate-500">{status}</p> : null}
    </section>
  );
}

function createEventUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractDateFromText(value: string): Date | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const normalized = value.replaceAll("\u00a0", " ");
  const ddMmYyyy = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+|T)?(\d{1,2})?[:.]?(\d{2})?/;
  const yyyyMmDd = /(\d{4})-(\d{2})-(\d{2})(?:\s+|T)?(\d{1,2})?[:.]?(\d{2})?/;

  const european = ddMmYyyy.exec(normalized);
  if (european) {
    const day = Number(european[1]);
    const month = Number(european[2]);
    const rawYear = Number(european[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const hour = european[4] ? Number(european[4]) : 10;
    const minute = european[5] ? Number(european[5]) : 0;
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const isoLike = yyyyMmDd.exec(normalized);
  if (isoLike) {
    const year = Number(isoLike[1]);
    const month = Number(isoLike[2]);
    const day = Number(isoLike[3]);
    const hour = isoLike[4] ? Number(isoLike[4]) : 10;
    const minute = isoLike[5] ? Number(isoLike[5]) : 0;
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function buildEventDetails(message: CalendarMessageInput | null): string {
  if (!message) {
    return "Mail üzerinden oluşturulan toplantı kaydı.";
  }

  const sender =
    message.fromName && message.fromEmail
      ? `${message.fromName} <${message.fromEmail}>`
      : message.fromEmail || message.fromName || "Bilinmiyor";
  const preview = message.bodyText?.trim() || message.snippet?.trim() || "";

  return [
    "Mail üzerinden oluşturuldu.",
    `Gönderen: ${sender}`,
    preview ? `Not: ${preview.slice(0, 400)}` : ""
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseLocalDateTime(value: string): Date | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function toDateTimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toCalendarDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}
