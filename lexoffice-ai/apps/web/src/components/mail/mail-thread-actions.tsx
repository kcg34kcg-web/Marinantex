"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";

type MessageState = "RECEIVED" | "ARCHIVED" | "SPAM" | "TRASH";

export function MailThreadActions({
  tenantSlug,
  tenantId,
  threadId,
  latestMessageId,
  latestMessageState
}: {
  tenantSlug: string;
  tenantId: string;
  threadId: string;
  latestMessageId: string | null;
  latestMessageState: string | null;
}) {
  const router = useRouter();
  const [pendingState, setPendingState] = useState<MessageState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canComposeFromThread = latestMessageId !== null;
  const canMoveToInbox =
    latestMessageState === "SPAM" || latestMessageState === "ARCHIVED" || latestMessageState === "TRASH";

  async function moveThread(state: MessageState): Promise<void> {
    if (!latestMessageId || pendingState) {
      return;
    }

    setPendingState(state);
    setError(null);

    const response = await fetch(withBasePath(`/api/v1/mail/messages/${latestMessageId}/state`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        state
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setError(payload.error?.message ?? "Mail işlemi başarısız");
      setPendingState(null);
      return;
    }

    router.push(`/${tenantSlug}/mail`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {canComposeFromThread ? (
          <>
            <Link className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" href={buildComposeHref(tenantSlug, threadId, latestMessageId, "reply")}>
              Yanıtla
            </Link>
            <Link className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" href={buildComposeHref(tenantSlug, threadId, latestMessageId, "reply-all")}>
              Tümüne Yanıtla
            </Link>
            <Link className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" href={buildComposeHref(tenantSlug, threadId, latestMessageId, "forward")}>
              İlet
            </Link>
          </>
        ) : (
          <span className="text-slate-500">Yanıtla/ilet için uygun mesaj bulunamadı</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {canMoveToInbox ? (
          <button
            type="button"
            className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            disabled={latestMessageId === null || pendingState !== null}
            onClick={() => {
              void moveThread("RECEIVED");
            }}
          >
            {pendingState === "RECEIVED"
              ? "Taşınıyor..."
              : latestMessageState === "SPAM"
                ? "Spamdan Çıkar"
                : "Gelen Kutusuna Taşı"}
          </button>
        ) : null}
        {latestMessageState !== "ARCHIVED" ? (
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-60"
            disabled={latestMessageId === null || pendingState !== null}
            onClick={() => {
              void moveThread("ARCHIVED");
            }}
          >
            {pendingState === "ARCHIVED" ? "Arşivleniyor..." : "Arşivle"}
          </button>
        ) : null}
        {latestMessageState !== "SPAM" ? (
          <button
            type="button"
            className="rounded border border-amber-300 px-2 py-1 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
            disabled={latestMessageId === null || pendingState !== null}
            onClick={() => {
              void moveThread("SPAM");
            }}
          >
            {pendingState === "SPAM" ? "Taşınıyor..." : "Spam"}
          </button>
        ) : null}
        {latestMessageState !== "TRASH" ? (
          <button
            type="button"
            className="rounded border border-rose-300 px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            disabled={latestMessageId === null || pendingState !== null}
            onClick={() => {
              void moveThread("TRASH");
            }}
          >
            {pendingState === "TRASH" ? "Siliniyor..." : "Sil"}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

function buildComposeHref(
  tenantSlug: string,
  threadId: string,
  messageId: string,
  mode: "reply" | "reply-all" | "forward"
): string {
  const params = new URLSearchParams({
    threadId,
    messageId,
    mode
  });

  return `/${tenantSlug}/mail/compose?${params.toString()}`;
}
