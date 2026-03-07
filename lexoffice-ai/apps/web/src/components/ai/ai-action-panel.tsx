"use client";

import { useState } from "react";

type Action =
  | "MAIL_SUMMARY"
  | "MAIL_REPLY_PROFESSIONAL"
  | "MAIL_REPLY_SHORT"
  | "MAIL_REPLY_FORMAL"
  | "THREAD_TASK_EXTRACTION"
  | "THREAD_ACTION_LIST"
  | "THREAD_MATTER_SUMMARY"
  | "SENSITIVE_DATA_CHECK";

const actionButtons: Array<{ action: Action; label: string }> = [
  { action: "MAIL_SUMMARY", label: "Bu maili özetle" },
  { action: "MAIL_REPLY_PROFESSIONAL", label: "Profesyonel cevap üret" },
  { action: "MAIL_REPLY_SHORT", label: "Kısa cevap üret" },
  { action: "THREAD_TASK_EXTRACTION", label: "Görev çıkar" },
  { action: "THREAD_MATTER_SUMMARY", label: "Matter özeti üret" },
  { action: "SENSITIVE_DATA_CHECK", label: "Hassas veri kontrolü" }
];

export function AIActionPanel({
  tenantId,
  threadId,
  messageId
}: {
  tenantId: string;
  threadId: string;
  messageId?: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [aiMessageId, setAiMessageId] = useState<string | null>(null);

  async function runAction(action: Action): Promise<void> {
    setIsPending(true);
    const response = await fetch("/api/v1/ai/mail-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        threadId,
        messageId,
        action,
        preferredLanguage: "tr"
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: { suggestion: string; aiMessageId: string };
      error?: { message: string };
    };

    if (payload.ok && payload.data) {
      setOutput(payload.data.suggestion);
      setAiMessageId(payload.data.aiMessageId);
    } else {
      setOutput(payload.error?.message ?? "AI işleminde hata oluştu");
    }

    setIsPending(false);
  }

  async function sendFeedback(accepted: boolean): Promise<void> {
    if (!aiMessageId) {
      return;
    }

    await fetch("/api/v1/ai/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, aiMessageId, accepted })
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">AI Action Panel</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actionButtons.map((button) => (
          <button
            key={button.action}
            type="button"
            disabled={isPending}
            onClick={() => {
              void runAction(button.action);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-60"
          >
            {button.label}
          </button>
        ))}
      </div>
      {output ? (
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          <p className="whitespace-pre-wrap">{output}</p>
          {aiMessageId ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-md border border-emerald-300 px-2 py-1 text-emerald-700"
                onClick={() => {
                  void sendFeedback(true);
                }}
              >
                Kabul Et
              </button>
              <button
                type="button"
                className="rounded-md border border-rose-300 px-2 py-1 text-rose-700"
                onClick={() => {
                  void sendFeedback(false);
                }}
              >
                Reddet
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
