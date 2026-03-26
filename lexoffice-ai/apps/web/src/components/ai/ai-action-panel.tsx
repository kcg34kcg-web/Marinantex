"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  AIActionType,
  AIStatsResponse,
  AIStructuredOutput,
  ApiResponse,
  RunAiMailActionResponse
} from "@lexoffice/contracts";
import { withBasePath } from "@/lib/base-path";

const actionButtons: Array<{ action: AIActionType; label: string }> = [
  { action: "MAIL_SUMMARY", label: "Bu maili özetle" },
  { action: "MAIL_REPLY_PROFESSIONAL", label: "Cevap taslağı oluştur (profesyonel)" },
  { action: "MAIL_REPLY_SHORT", label: "Kısa cevap üret" },
  { action: "MAIL_REPLY_FORMAL", label: "Resmi cevap üret" },
  { action: "THREAD_TASK_EXTRACTION", label: "Görev çıkar" },
  { action: "THREAD_ACTION_LIST", label: "Aksiyon listesi çıkar" },
  { action: "THREAD_MATTER_SUMMARY", label: "Matter özeti üret" },
  { action: "SENSITIVE_DATA_CHECK", label: "Hassas veri kontrolü" }
];

type PanelMeta = {
  action: AIActionType;
  structuredOutput: AIStructuredOutput;
  humanApprovalRequired: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type StreamEvent = {
  event: string;
  data: unknown;
};

function parseSseEvent(packet: string): StreamEvent | null {
  const normalized = packet.replace(/\r/g, "").trim();
  if (!normalized) {
    return null;
  }

  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of normalized.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join("\n");
  try {
    return {
      event: eventName,
      data: JSON.parse(rawData) as unknown
    };
  } catch {
    return null;
  }
}

export function AIActionPanel({
  tenantSlug,
  tenantId,
  threadId,
  messageId
}: {
  tenantSlug: string;
  tenantId: string;
  threadId: string;
  messageId?: string;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [aiMessageId, setAiMessageId] = useState<string | null>(null);
  const [streamMode, setStreamMode] = useState(true);
  const [lastMeta, setLastMeta] = useState<PanelMeta | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [feedbackState, setFeedbackState] = useState<"accepted" | "rejected" | null>(null);
  const [stats, setStats] = useState<AIStatsResponse | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const loadStats = useCallback(async (): Promise<void> => {
    setStatsLoading(true);
    setStatsError(null);

    const params = new URLSearchParams({ tenantId });
    const response = await fetch(withBasePath(`/api/v1/ai/stats?${params.toString()}`), {
      method: "GET",
      cache: "no-store"
    });
    const payload = (await response.json()) as ApiResponse<AIStatsResponse>;

    if (!payload.ok) {
      setStatsError(payload.error.message);
      setStatsLoading(false);
      return;
    }

    setStats(payload.data);
    setStatsLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const runActionAsJson = useCallback(
    async (action: AIActionType): Promise<void> => {
      const response = await fetch(withBasePath("/api/v1/ai/mail-actions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          threadId,
          messageId,
          action,
          preferredLanguage: "tr",
          stream: false
        })
      });

      const payload = (await response.json()) as ApiResponse<RunAiMailActionResponse>;
      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setOutput(payload.data.suggestion);
      setAiMessageId(payload.data.aiMessageId);
      setLastMeta({
        action: payload.data.action,
        structuredOutput: payload.data.structuredOutput,
        humanApprovalRequired: payload.data.humanApprovalRequired,
        usage: payload.data.usage
      });
    },
    [messageId, tenantId, threadId]
  );

  const runActionAsStream = useCallback(
    async (action: AIActionType): Promise<void> => {
      const response = await fetch(withBasePath("/api/v1/ai/mail-actions/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          threadId,
          messageId,
          action,
          preferredLanguage: "tr",
          stream: true
        })
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/event-stream")) {
        let message = "AI stream yanıtı alınamadı";
        try {
          const fallback = (await response.json()) as ApiResponse<unknown>;
          if (!fallback.ok) {
            message = fallback.error.message;
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error("AI stream gövdesi boş döndü");
      }

      setOutput("");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let splitIndex = buffer.indexOf("\n\n");
        while (splitIndex >= 0) {
          const packet = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);
          const parsed = parseSseEvent(packet);
          if (parsed) {
            if (parsed.event === "error") {
              const errorPayload = parsed.data as { message?: string };
              throw new Error(errorPayload.message ?? "AI stream kesildi");
            }
            handleSseEvent(parsed, setAiMessageId, setLastMeta, setOutput);
          }
          splitIndex = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) {
        const parsed = parseSseEvent(buffer);
        if (parsed) {
          if (parsed.event === "error") {
            const errorPayload = parsed.data as { message?: string };
            throw new Error(errorPayload.message ?? "AI stream kesildi");
          }
          handleSseEvent(parsed, setAiMessageId, setLastMeta, setOutput);
        }
      }
    },
    [messageId, tenantId, threadId]
  );

  const runAction = useCallback(
    async (action: AIActionType): Promise<void> => {
      setIsPending(true);
      setPanelError(null);
      setFeedbackState(null);
      setAiMessageId(null);
      setLastMeta(null);
      setOutput(null);

      try {
        if (streamMode) {
          await runActionAsStream(action);
        } else {
          await runActionAsJson(action);
        }
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : "AI işleminde hata oluştu");
      } finally {
        setIsPending(false);
        void loadStats();
      }
    },
    [loadStats, runActionAsJson, runActionAsStream, streamMode]
  );

  const sendFeedback = useCallback(
    async (accepted: boolean): Promise<void> => {
      if (!aiMessageId) {
        return;
      }

      const response = await fetch(withBasePath("/api/v1/ai/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, aiMessageId, accepted })
      });

      const payload = (await response.json()) as ApiResponse<{ success: true }>;
      if (!payload.ok) {
        setPanelError(payload.error.message);
        return;
      }

      setFeedbackState(accepted ? "accepted" : "rejected");
      void loadStats();
    },
    [aiMessageId, loadStats, tenantId]
  );

  const topActions = useMemo(() => {
    if (!stats) {
      return [];
    }

    return [...stats.byAction]
      .sort((left, right) => right.suggestions - left.suggestions)
      .slice(0, 4);
  }, [stats]);

  const replyMeta = useMemo(() => {
    if (!lastMeta || lastMeta.structuredOutput.type !== "reply") {
      return null;
    }
    return lastMeta.structuredOutput;
  }, [lastMeta]);

  const transferReplyDraft = useCallback(() => {
    if (!replyMeta) {
      return;
    }

    const params = new URLSearchParams({
      aiDraftSubject: replyMeta.subjectSuggestion.slice(0, 200),
      aiDraftBody: replyMeta.body.slice(0, 4_000)
    });

    if (messageId) {
      params.set("threadId", threadId);
      params.set("messageId", messageId);
      params.set("mode", "reply");
    }

    router.push(`/${tenantSlug}/mail/compose?${params.toString()}`);
  }, [messageId, replyMeta, router, tenantSlug, threadId]);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">AI Action Panel</h3>
        <button
          type="button"
          className={`rounded-md border px-2 py-1 text-[11px] ${
            streamMode
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-slate-300 text-slate-600"
          }`}
          onClick={() => {
            setStreamMode((previous) => !previous);
          }}
          disabled={isPending}
        >
          Stream: {streamMode ? "Açık" : "Kapalı"}
        </button>
      </div>

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

      {panelError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {panelError}
        </p>
      ) : null}

      {output ? (
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          <p className="whitespace-pre-wrap">{output}</p>
          {replyMeta ? (
            <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-700">
              <p>Konu önerisi: {replyMeta.subjectSuggestion}</p>
              <p>Ton: {formatReplyTone(replyMeta.tone)}</p>
              <button
                type="button"
                className="mt-2 rounded border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] text-brand-700"
                onClick={transferReplyDraft}
              >
                Taslağı Compose&apos;a Aktar
              </button>
            </div>
          ) : null}
          {lastMeta ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
              <p>
                Token kullanımı: {lastMeta.usage.totalTokens} (in: {lastMeta.usage.inputTokens} /
                out: {lastMeta.usage.outputTokens})
              </p>
              <p>İnsan onayı zorunlu: {lastMeta.humanApprovalRequired ? "Evet" : "Hayır"}</p>
            </div>
          ) : null}
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
          {feedbackState ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Geri bildirim kaydedildi: {feedbackState === "accepted" ? "Kabul" : "Red"}
            </p>
          ) : null}
        </div>
      ) : null}

      {lastMeta ? (
        <details className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
          <summary className="cursor-pointer font-medium text-slate-700">Structured output</summary>
          <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
            {JSON.stringify(lastMeta.structuredOutput, null, 2)}
          </pre>
        </details>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-800">Tenant AI Metrikleri</p>
        {statsLoading ? (
          <p className="mt-1 text-[11px] text-slate-500">Metrikler yükleniyor...</p>
        ) : null}
        {statsError ? <p className="mt-1 text-[11px] text-rose-700">{statsError}</p> : null}
        {stats ? (
          <div className="mt-2 space-y-2 text-[11px] text-slate-600">
            <p>
              Toplam öneri: {stats.totals.suggestions} | Kabul: {stats.totals.accepted} | Red:{" "}
              {stats.totals.rejected} | Kabul oranı:{" "}
              {(stats.totals.acceptanceRate * 100).toFixed(1)}%
            </p>
            <p>
              Token toplamı: {stats.tokenUsage.totalTokens} (in: {stats.tokenUsage.inputTokens} /
              out: {stats.tokenUsage.outputTokens})
            </p>
            {topActions.length > 0 ? (
              <ul className="space-y-1">
                {topActions.map((entry) => (
                  <li key={entry.action}>
                    {entry.action}: {entry.suggestions} öneri
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function handleSseEvent(
  event: StreamEvent,
  setAiMessageId: Dispatch<SetStateAction<string | null>>,
  setLastMeta: Dispatch<SetStateAction<PanelMeta | null>>,
  setOutput: Dispatch<SetStateAction<string | null>>
) {
  if (event.event === "meta") {
    const data = event.data as {
      aiMessageId: string;
      action: AIActionType;
      structuredOutput: AIStructuredOutput;
      humanApprovalRequired: boolean;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    };
    setAiMessageId(data.aiMessageId);
    setLastMeta({
      action: data.action,
      structuredOutput: data.structuredOutput,
      humanApprovalRequired: data.humanApprovalRequired,
      usage: data.usage
    });
    return;
  }

  if (event.event === "chunk") {
    const data = event.data as { content: string };
    setOutput((previous) => `${previous ?? ""}${data.content}`);
  }
}

function formatReplyTone(tone: "professional" | "short" | "formal"): string {
  if (tone === "professional") {
    return "Profesyonel";
  }
  if (tone === "short") {
    return "Kısa";
  }
  return "Resmi";
}
