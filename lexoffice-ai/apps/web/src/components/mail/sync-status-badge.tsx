export function SyncStatusBadge({
  status,
  lastSyncedAt
}: {
  status: string;
  lastSyncedAt?: string | null;
}) {
  const tone =
    status === "RUNNING"
      ? "bg-amber-100 text-amber-800"
      : status === "FAILED"
        ? "bg-rose-100 text-rose-800"
        : "bg-emerald-100 text-emerald-800";

  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${tone}`}>
        {status === "RUNNING" ? (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-700" />
        ) : null}
        Sync: {status}
      </span>
      {lastSyncedAt ? (
        <span className="text-slate-500">
          Son: {new Date(lastSyncedAt).toLocaleString("tr-TR")}
        </span>
      ) : null}
    </div>
  );
}
