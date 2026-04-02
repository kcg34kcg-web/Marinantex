"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";

type MessageState = "RECEIVED" | "ARCHIVED" | "SPAM" | "TRASH";
type ComposeMode = "reply" | "reply-all" | "forward";

export function MailThreadActions({
  tenantSlug,
  tenantId,
  threadId,
  mailboxId,
  latestMessageId,
  latestMessageState,
  hasFollowUpLabel,
  onCompose
}: {
  tenantSlug: string;
  tenantId: string;
  threadId: string;
  mailboxId: string | null;
  latestMessageId: string | null;
  latestMessageState: string | null;
  hasFollowUpLabel: boolean;
  onCompose?: (mode: ComposeMode, context: { threadId: string; messageId: string }) => void;
}) {
  const router = useRouter();
  const [pendingState, setPendingState] = useState<MessageState | null>(null);
  const [moveTarget, setMoveTarget] = useState<MessageState>("RECEIVED");
  const [pendingFollowUp, setPendingFollowUp] = useState(false);
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

  async function getOrCreateFollowUpLabelId(): Promise<string> {
    if (!mailboxId) {
      throw new Error("Takip etiketi için mailbox bilgisi bulunamadı.");
    }

    const labelsResponse = await fetch(
      withBasePath(
        `/api/v1/mail/labels?tenantId=${encodeURIComponent(tenantId)}&mailboxId=${encodeURIComponent(mailboxId)}`
      ),
      {
        method: "GET",
        cache: "no-store"
      }
    );

    const labelsPayload = (await labelsResponse.json()) as {
      ok: boolean;
      data?: {
        labels?: Array<{
          id: string;
          name: string;
        }>;
      };
      error?: {
        message: string;
      };
    };

    if (!labelsResponse.ok || !labelsPayload.ok) {
      throw new Error(labelsPayload.error?.message ?? "Etiket listesi alınamadı");
    }

    const existing = labelsPayload.data?.labels?.find((label) => isFollowUpLabelName(label.name));
    if (existing) {
      return existing.id;
    }

    const createResponse = await fetch(withBasePath("/api/v1/mail/labels"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        mailboxId,
        name: "Takip"
      })
    });

    const createPayload = (await createResponse.json()) as {
      ok: boolean;
      data?: {
        label?: {
          id: string;
        };
      };
      error?: {
        message: string;
      };
    };

    if (!createResponse.ok || !createPayload.ok || !createPayload.data?.label?.id) {
      throw new Error(createPayload.error?.message ?? "Takip etiketi oluşturulamadı");
    }

    return createPayload.data.label.id;
  }

  async function toggleFollowUpLabel(): Promise<void> {
    if (!latestMessageId || pendingFollowUp) {
      return;
    }

    try {
      setPendingFollowUp(true);
      setError(null);

      const followUpLabelId = await getOrCreateFollowUpLabelId();
      const response = await fetch(withBasePath(`/api/v1/mail/messages/${latestMessageId}/labels`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          labelId: followUpLabelId,
          action: hasFollowUpLabel ? "remove" : "add"
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!payload.ok) {
        throw new Error(payload.error?.message ?? "Takip etiketi güncellenemedi");
      }

      router.refresh();
    } catch (followUpError) {
      setError(
        followUpError instanceof Error ? followUpError.message : "Takip etiketi işlemi başarısız"
      );
    } finally {
      setPendingFollowUp(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {canComposeFromThread ? (
          (onCompose && latestMessageId ? (
            <>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                onClick={() => onCompose("reply", { threadId, messageId: latestMessageId })}
              >
                Yanıtla
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                onClick={() => onCompose("reply-all", { threadId, messageId: latestMessageId })}
              >
                Tümüne Yanıtla
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                onClick={() => onCompose("forward", { threadId, messageId: latestMessageId })}
              >
                İlet
              </button>
            </>
          ) : (
            <>
              <a
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                href={buildComposeHref(tenantSlug, threadId, latestMessageId, "reply")}
              >
                Yanıtla
              </a>
              <a
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                href={buildComposeHref(tenantSlug, threadId, latestMessageId, "reply-all")}
              >
                Tümüne Yanıtla
              </a>
              <a
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                href={buildComposeHref(tenantSlug, threadId, latestMessageId, "forward")}
              >
                İlet
              </a>
            </>
          ))
        ) : (
          <span className="text-slate-500">Yanıtla/ilet için uygun mesaj bulunamadı</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1">
          <span className="text-[11px] text-slate-500">Klasöre Taşı:</span>
          <select
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
            value={moveTarget}
            disabled={latestMessageId === null || pendingState !== null}
            onChange={(event) => {
              if (isMessageState(event.target.value)) {
                setMoveTarget(event.target.value);
              }
            }}
          >
            <option value="RECEIVED">Gelen Kutusu</option>
            <option value="ARCHIVED">Arşiv</option>
            <option value="SPAM">Spam</option>
            <option value="TRASH">Çöp</option>
          </select>
          <button
            type="button"
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:bg-slate-100 disabled:opacity-60"
            disabled={
              latestMessageId === null || pendingState !== null || latestMessageState === moveTarget
            }
            onClick={() => {
              void moveThread(moveTarget);
            }}
          >
            Taşı
          </button>
        </div>
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
        <button
          type="button"
          className="rounded border border-indigo-300 px-2 py-1 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
          disabled={latestMessageId === null || pendingFollowUp}
          onClick={() => {
            void toggleFollowUpLabel();
          }}
        >
          {pendingFollowUp
            ? "Güncelleniyor..."
            : hasFollowUpLabel
              ? "Takip Etiketini Kaldır"
              : "Takip Etiketi Ekle"}
        </button>
      </div>

      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

function isFollowUpLabelName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "takip" || normalized === "follow-up" || normalized === "follow up";
}

function isMessageState(value: string): value is MessageState {
  return value === "RECEIVED" || value === "ARCHIVED" || value === "SPAM" || value === "TRASH";
}

function buildComposeHref(
  tenantSlug: string,
  threadId: string,
  messageId: string,
  mode: ComposeMode
): string {
  const params = new URLSearchParams({
    threadId,
    messageId,
    mode
  });

  return `/${tenantSlug}/mail/compose?${params.toString()}`;
}
