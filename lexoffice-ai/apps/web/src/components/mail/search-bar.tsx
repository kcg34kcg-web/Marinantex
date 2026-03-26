"use client";

import { useEffect, useState } from "react";

const SAVED_QUERIES_KEY = "mail.search.savedQueries";

export function SearchBar({
  defaultValue,
  onSearch
}: {
  defaultValue?: string;
  onSearch: (query: string) => void;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [savedQueries, setSavedQueries] = useState<string[]>([]);

  useEffect(() => {
    setValue(defaultValue ?? "");
  }, [defaultValue]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(SAVED_QUERIES_KEY);
    if (!raw) {
      setSavedQueries([]);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setSavedQueries([]);
        return;
      }
      const normalized = parsed.filter((entry): entry is string => typeof entry === "string");
      setSavedQueries(normalized.slice(0, 10));
    } catch {
      setSavedQueries([]);
    }
  }, []);

  function persistSavedQueries(nextQueries: string[]): void {
    setSavedQueries(nextQueries);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(nextQueries.slice(0, 10)));
    }
  }

  function saveCurrentQuery(): void {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return;
    }

    const deduped = [normalized, ...savedQueries.filter((query) => query !== normalized)].slice(0, 10);
    persistSavedQueries(deduped);
  }

  return (
    <div className="space-y-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(value);
        }}
      >
        <input
          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
          placeholder="Mail ara (örn: from:ahmet@firma.com sözleşme)"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Ara
        </button>
        <button
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          type="button"
          onClick={() => {
            setValue("");
            onSearch("");
          }}
        >
          Temizle
        </button>
      </form>
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600"
          onClick={saveCurrentQuery}
        >
          Aramayı Kaydet
        </button>
        {savedQueries.length > 0 ? (
          <>
            <span className="text-slate-500">Kayıtlı:</span>
            <select
              className="max-w-[320px] rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value=""
              onChange={(event) => {
                const selected = event.target.value;
                if (!selected) {
                  return;
                }
                setValue(selected);
                onSearch(selected);
              }}
            >
              <option value="">Seçin</option>
              {savedQueries.map((query) => (
                <option key={query} value={query}>
                  {query}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-slate-400">Kayıtlı arama yok</span>
        )}
      </div>
    </div>
  );
}
