export function MailSidebar({
  mailboxes,
  selectedMailboxId,
  onSelectMailbox
}: {
  mailboxes: Array<{
    id: string;
    email: string;
    unreadCount?: number;
    connectionStatus?: string | null;
  }>;
  selectedMailboxId?: string;
  onSelectMailbox: (mailboxId?: string) => void;
}) {
  return (
    <aside className="w-full border-r border-slate-200 bg-white lg:w-72">
      <div className="border-b border-slate-200 p-3">
        <button
          type="button"
          className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
            !selectedMailboxId ? "bg-brand-50 text-brand-700" : "hover:bg-slate-100"
          }`}
          onClick={() => onSelectMailbox(undefined)}
        >
          Unified Inbox
        </button>
      </div>

      <div className="p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Mailboxlar
        </p>
        <ul className="space-y-1">
          {mailboxes.map((mailbox) => (
            <li key={mailbox.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                  mailbox.id === selectedMailboxId
                    ? "bg-brand-50 text-brand-700"
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
                <span className="flex items-center gap-1">
                  {mailbox.unreadCount && mailbox.unreadCount > 0 ? (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                      {mailbox.unreadCount}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
