"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";

type MatterOption = {
  id: string;
  title: string;
};

export function TaskCreateForm({
  tenantId,
  matters
}: {
  tenantId: string;
  matters: MatterOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [matterId, setMatterId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueAt, setDueAt] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const response = await fetch(withBasePath("/api/v1/tasks"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        title,
        priority,
        ...(matterId ? { matterId } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {})
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: {
        message: string;
      };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Task oluşturulamadı");
      setPending(false);
      return;
    }

    setTitle("");
    setDueAt("");
    setPending(false);
    setStatus("Task oluşturuldu");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-slate-900">Yeni Task</h2>
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Task başlığı"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          value={matterId}
          onChange={(event) => setMatterId(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Matter yok</option>
          {matters.map((matter) => (
            <option key={matter.id} value={matter.id}>
              {matter.title}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>
      <input
        type="datetime-local"
        value={dueAt}
        onChange={(event) => setDueAt(event.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Oluşturuluyor..." : "Task Oluştur"}
      </button>
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </form>
  );
}
