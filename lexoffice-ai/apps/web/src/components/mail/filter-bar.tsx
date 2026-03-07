"use client";

const filters = [
  { id: "unread", label: "Okunmamış" },
  { id: "sensitive", label: "Hassas" }
];

export function FilterBar({
  active,
  onChange
}: {
  active: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => {
        const selected = active.includes(filter.id);

        return (
          <button
            key={filter.id}
            type="button"
            onClick={() => {
              onChange(
                selected ? active.filter((item) => item !== filter.id) : [...active, filter.id]
              );
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              selected
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
