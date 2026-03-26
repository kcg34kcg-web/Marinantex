type SidebarView =
  | "inbox"
  | "unread"
  | "starred"
  | "important"
  | "drafts"
  | "sent"
  | "trash"
  | "spam"
  | "archive"
  | "label";

const systemViews: Array<{ id: Exclude<SidebarView, "label">; label: string }> = [
  { id: "inbox", label: "Gelen Kutusu" },
  { id: "unread", label: "Okunmamış" },
  { id: "starred", label: "Yıldızlı" },
  { id: "important", label: "Önemli" },
  { id: "drafts", label: "Taslaklar" },
  { id: "sent", label: "Gönderilmiş" },
  { id: "archive", label: "Arşiv" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Çöp Kutusu" }
];

export function MailSidebar({
  mailboxes,
  labels,
  selectedMailboxId,
  selectedView,
  selectedLabelId,
  onSelectMailbox,
  onSelectView,
  onCreateLabel,
  onCompose
}: {
  mailboxes: Array<{
    id: string;
    email: string;
    unreadCount?: number;
    connectionStatus?: string | null;
  }>;
  labels: Array<{
    id: string;
    mailboxId: string;
    name: string;
    color: string | null;
    isSystem: boolean;
    type: string;
  }>;
  selectedMailboxId?: string;
  selectedView: SidebarView;
  selectedLabelId?: string;
  onSelectMailbox: (mailboxId?: string) => void;
  onSelectView: (view: SidebarView, labelId?: string) => void;
  onCreateLabel: () => void;
  onCompose: () => void;
}) {
  return (
    <aside className="w-full border-r border-slate-200 bg-[#f8fafd] lg:w-64">
      <div className="border-b border-slate-200 px-4 py-4">
        <button
          type="button"
          onClick={onCompose}
          className="inline-flex w-full items-center justify-center rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          + Yeni Mail
        </button>
      </div>

      <div className="border-b border-slate-200 p-3">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Klasörler</p>
        <ul className="space-y-1">
          {systemViews.map((view) => (
            <li key={view.id}>
              <button
                type="button"
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  selectedView === view.id
                    ? "bg-brand-100 font-medium text-brand-800"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() => onSelectView(view.id)}
              >
                {view.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-b border-slate-200 p-3">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Hesaplar</p>
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                !selectedMailboxId ? "bg-brand-100 font-medium text-brand-800" : "text-slate-700 hover:bg-slate-100"
              }`}
              onClick={() => onSelectMailbox(undefined)}
            >
              Tüm Mailboxlar
            </button>
          </li>
          {mailboxes.map((mailbox) => (
            <li key={mailbox.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${
                  mailbox.id === selectedMailboxId
                    ? "bg-brand-100 font-medium text-brand-800"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() => onSelectMailbox(mailbox.id)}
              >
                <span className="flex min-w-0 items-center gap-1">
                  {mailbox.connectionStatus && mailbox.connectionStatus !== "CONNECTED" ? (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                  ) : null}
                  <span className="truncate">{mailbox.email}</span>
                </span>
                {mailbox.unreadCount && mailbox.unreadCount > 0 ? (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                    {mailbox.unreadCount}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Etiketler</p>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700"
            onClick={onCreateLabel}
          >
            Etiket Ekle
          </button>
        </div>
        {labels.length === 0 ? (
          <p className="text-xs text-slate-500">Henüz özel etiket yok.</p>
        ) : (
          <ul className="space-y-1">
            {labels.map((label) => (
              <li key={label.id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${
                    selectedView === "label" && selectedLabelId === label.id
                      ? "bg-brand-100 font-medium text-brand-800"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                  onClick={() => onSelectView("label", label.id)}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: label.color ?? "#64748b" }}
                  />
                  <span className="truncate">{label.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
