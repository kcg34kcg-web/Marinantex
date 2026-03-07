"use client";

import { useEffect, useState } from "react";

export function SearchBar({
  defaultValue,
  onSearch
}: {
  defaultValue?: string;
  onSearch: (query: string) => void;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  useEffect(() => {
    setValue(defaultValue ?? "");
  }, [defaultValue]);

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value);
      }}
    >
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Mail ara (örn: from:ahmet@firma.com sözleşme)"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white"
        type="submit"
      >
        Ara
      </button>
    </form>
  );
}
