"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";

export function MatterLinkPanel({
  tenantId,
  threadId,
  linkedMatter,
  sourceMessageId
}: {
  tenantId: string;
  threadId: string;
  linkedMatter?: { id: string; title: string; referenceNo?: string | null } | null;
  sourceMessageId?: string;
}) {
  const router = useRouter();
  const [matterId, setMatterId] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [pending, setPending] = useState(false);
  const [taskPending, setTaskPending] = useState(false);

  async function submit(): Promise<void> {
    if (matterId.trim().length === 0) {
      setLinkStatus("Matter ID zorunlu");
      return;
    }

    setPending(true);
    setLinkStatus(null);
    const response = await fetch(withBasePath(`/api/v1/mail/threads/${threadId}/matter`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        matterId: matterId.trim(),
        ...(linkNote.trim().length > 0 ? { note: linkNote.trim() } : {})
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: { matterTitle?: string; matterReferenceNo?: string | null };
      error?: { message: string };
    };

    if (!payload.ok) {
      setLinkStatus(payload.error?.message ?? "Thread matter'a bağlanamadı");
      setPending(false);
      return;
    }

    const matterLabel = payload.data?.matterReferenceNo
      ? `${payload.data?.matterTitle ?? "Matter"} (${payload.data.matterReferenceNo})`
      : payload.data?.matterTitle ?? "Matter";

    setLinkStatus(`Thread başarıyla matter'a bağlandı: ${matterLabel}`);
    setMatterId("");
    setLinkNote("");
    setPending(false);
    router.refresh();
  }

  async function createTaskFromThread(): Promise<void> {
    if (taskTitle.trim().length < 2) {
      setTaskStatus("Task başlığı en az 2 karakter olmalı");
      return;
    }

    setTaskPending(true);
    setTaskStatus(null);

    const response = await fetch(withBasePath("/api/v1/tasks"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        title: taskTitle.trim(),
        ...(linkedMatter ? { matterId: linkedMatter.id } : {}),
        ...(taskDueAt ? { dueAt: new Date(taskDueAt).toISOString() } : {}),
        ...(sourceMessageId ? { sourceMessageId } : {})
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: {
        message: string;
      };
    };

    if (!payload.ok) {
      setTaskStatus(payload.error?.message ?? "Task oluşturulamadı");
      setTaskPending(false);
      return;
    }

    setTaskTitle("");
    setTaskDueAt("");
    setTaskPending(false);
    setTaskStatus("Thread kaynağından task oluşturuldu");
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Matter Link</h3>
      <p className="mt-1 text-xs text-slate-600">Thread ID: {threadId}</p>
      {linkedMatter ? (
        <p className="mt-1 text-xs text-emerald-700">
          Mevcut link: {linkedMatter.title}
          {linkedMatter.referenceNo ? ` (${linkedMatter.referenceNo})` : ""}
        </p>
      ) : null}
      <input
        value={matterId}
        onChange={(event) => setMatterId(event.target.value)}
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Matter ID girin"
      />
      <textarea
        value={linkNote}
        onChange={(event) => setLinkNote(event.target.value)}
        className="mt-2 min-h-[80px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Opsiyonel not (matter timeline için)"
      />
      <button
        type="button"
        disabled={pending}
        className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-xs"
        onClick={() => {
          void submit();
        }}
      >
        {pending ? "Bağlanıyor..." : "Matter'a Bağla"}
      </button>

      {linkStatus ? <p className="mt-2 text-xs text-slate-500">{linkStatus}</p> : null}

      <div className="mt-4 border-t border-slate-200 pt-3">
        <p className="text-xs font-semibold text-slate-700">Thread'den Görev Oluştur</p>
        <input
          value={taskTitle}
          onChange={(event) => setTaskTitle(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Görev başlığı girin"
        />
        <input
          type="datetime-local"
          value={taskDueAt}
          onChange={(event) => setTaskDueAt(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={taskPending}
          className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-xs"
          onClick={() => {
            void createTaskFromThread();
          }}
        >
          {taskPending ? "Oluşturuluyor..." : "Task Oluştur"}
        </button>
        {taskStatus ? <p className="mt-2 text-xs text-slate-500">{taskStatus}</p> : null}
      </div>
    </section>
  );
}
