"use client";

import { useState } from "react";

export function FilterBar({
  readStatus,
  dateFrom,
  dateTo,
  withAttachments,
  onlyStarred,
  sortBy,
  sortDirection,
  sensitiveOnly,
  onReadStatusChange,
  onDateFromChange,
  onDateToChange,
  onWithAttachmentsChange,
  onOnlyStarredChange,
  onSortByChange,
  onSortDirectionChange,
  onSensitiveToggle
}: {
  readStatus: "all" | "read" | "unread";
  dateFrom: string;
  dateTo: string;
  withAttachments: boolean;
  onlyStarred: boolean;
  sortBy: "date" | "sender";
  sortDirection: "asc" | "desc";
  sensitiveOnly: boolean;
  onReadStatusChange: (value: "all" | "read" | "unread") => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onWithAttachmentsChange: (value: boolean) => void;
  onOnlyStarredChange: (value: boolean) => void;
  onSortByChange: (value: "date" | "sender") => void;
  onSortDirectionChange: (value: "asc" | "desc") => void;
  onSensitiveToggle: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Okunma
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            value={readStatus}
            onChange={(event) => {
              onReadStatusChange(event.target.value as "all" | "read" | "unread");
            }}
          >
            <option value="all">Tümü</option>
            <option value="read">Okundu</option>
            <option value="unread">Okunmadı</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          Sırala
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            value={sortBy}
            onChange={(event) => {
              onSortByChange(event.target.value as "date" | "sender");
            }}
          >
            <option value="date">Tarih</option>
            <option value="sender">Gönderen</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          Yön
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            value={sortDirection}
            onChange={(event) => {
              onSortDirectionChange(event.target.value as "asc" | "desc");
            }}
          >
            <option value="desc">Azalan</option>
            <option value="asc">Artan</option>
          </select>
        </label>

        <button
          type="button"
          onClick={() => setAdvancedOpen((current) => !current)}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            advancedOpen
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-slate-300 bg-white text-slate-700"
          }`}
        >
          Gelişmiş Arama
        </button>

        <button
          type="button"
          onClick={onSensitiveToggle}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            sensitiveOnly
              ? "border-orange-300 bg-orange-50 text-orange-700"
              : "border-slate-300 bg-white text-slate-700"
          }`}
        >
          Hassas
        </button>
      </div>

      {advancedOpen ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Tarih (Başlangıç)
            <input
              type="date"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={dateFrom}
              onChange={(event) => onDateFromChange(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Tarih (Bitiş)
            <input
              type="date"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={dateTo}
              onChange={(event) => onDateToChange(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={withAttachments}
              onChange={(event) => onWithAttachmentsChange(event.target.checked)}
            />
            Sadece ekli mailler
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={onlyStarred}
              onChange={(event) => onOnlyStarredChange(event.target.checked)}
            />
            Sadece yıldızlılar
          </label>
        </div>
      ) : null}
    </div>
  );
}
