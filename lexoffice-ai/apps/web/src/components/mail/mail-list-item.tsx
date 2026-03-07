export type MailListItemViewModel = {
  id: string;
  subject: string | null;
  snippet: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  sender: string;
  latestMessageIsSensitive: boolean;
};

export function MailListItem({
  item,
  active,
  checked,
  onToggleChecked,
  onActivate,
  onOpen
}: {
  item: MailListItemViewModel;
  active: boolean;
  checked: boolean;
  onToggleChecked: (threadId: string) => void;
  onActivate: (threadId: string) => void;
  onOpen: (threadId: string) => void;
}) {
  return (
    <div
      className={`border-b border-slate-100 px-3 py-2 transition ${
        active ? "bg-brand-50/70" : "bg-white hover:bg-slate-50"
      }`}
      onMouseEnter={() => {
        onActivate(item.id);
      }}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleChecked(item.id)}
          className="mt-1 h-4 w-4 rounded border-slate-300"
          onClick={(event) => {
            event.stopPropagation();
          }}
          aria-label="Thread seç"
        />
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="min-w-0 flex-1 text-left"
          aria-current={active ? "true" : undefined}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <p
              className={`truncate text-sm ${item.unreadCount > 0 ? "font-semibold text-slate-900" : "text-slate-700"}`}
            >
              {item.sender}
            </p>
            <p className="shrink-0 text-xs text-slate-500">
              {item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleDateString("tr-TR") : "-"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <p
              className={`truncate text-sm ${item.unreadCount > 0 ? "font-semibold text-slate-900" : "text-slate-700"}`}
            >
              {item.subject ?? "(Konu yok)"}
            </p>
            {item.latestMessageIsSensitive ? (
              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">
                Hassas
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-slate-500">{item.snippet ?? "İçerik yok"}</p>
        </button>
      </div>
    </div>
  );
}
