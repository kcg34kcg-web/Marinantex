export type MailListItemViewModel = {
  id: string;
  kind: "THREAD" | "DRAFT";
  subject: string | null;
  snippet: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  sender: string;
  latestMessageIsSensitive: boolean;
  latestMessageIsStarred: boolean;
  latestMessageIsImportant: boolean;
  latestMessageState: string | null;
};

export function MailListItem({
  item,
  active,
  checked,
  onToggleChecked,
  onToggleStar,
  onToggleImportant,
  onActivate,
  onOpen
}: {
  item: MailListItemViewModel;
  active: boolean;
  checked: boolean;
  onToggleChecked: (threadId: string) => void;
  onToggleStar: (threadId: string) => void;
  onToggleImportant: (threadId: string) => void;
  onActivate: (threadId: string) => void;
  onOpen: (threadId: string) => void;
}) {
  const openItem = () => {
    onActivate(item.id);
    onOpen(item.id);
  };

  return (
    <div
      className={`app-mail-row border-b border-slate-100 px-3 py-2 transition ${
        active ? "bg-brand-50/70" : "bg-white hover:bg-slate-50/80"
      }`}
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: "132px"
      }}
    >
      <div className="flex items-start gap-2.5">
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
          className={`mt-0.5 rounded border px-1.5 py-0.5 text-[10px] ${
            item.latestMessageIsStarred
              ? "border-amber-300 bg-amber-50 text-amber-700"
              : "border-slate-200 text-slate-500"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleStar(item.id);
          }}
          aria-label="Yıldız durumu değiştir"
        >
          ★
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={openItem}
          className="min-w-0 flex-1 cursor-pointer text-left"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openItem();
            }
          }}
          onFocus={() => {
            onActivate(item.id);
          }}
          aria-current={active ? "true" : undefined}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2">
                <p
                  className={`truncate text-sm ${item.unreadCount > 0 ? "font-semibold text-slate-900" : "text-slate-700"}`}
                >
                  {item.sender}
                </p>
                {item.kind === "DRAFT" ? (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">
                    Taslak
                  </span>
                ) : null}
                {item.latestMessageState === "SPAM" ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                    Spam
                  </span>
                ) : null}
                {item.latestMessageState === "TRASH" ? (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">
                    Çöp
                  </span>
                ) : null}
                {item.latestMessageState === "ARCHIVED" ? (
                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                    Arşiv
                  </span>
                ) : null}
                {item.latestMessageIsSensitive ? (
                  <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">
                    Hassas
                  </span>
                ) : null}
              </div>
              <p
                className={`truncate text-sm ${item.unreadCount > 0 ? "font-semibold text-slate-900" : "text-slate-700"}`}
              >
                {item.subject ?? "(Konu yok)"}
              </p>
              <p className="truncate text-xs text-slate-500">{item.snippet ?? "İçerik yok"}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="text-xs text-slate-500">
                {item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleDateString("tr-TR") : "-"}
              </p>
              <button
                type="button"
                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  item.latestMessageIsImportant
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-slate-200 text-slate-500"
                }`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleImportant(item.id);
                }}
                aria-label="Önemli durumu değiştir"
              >
                !
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
