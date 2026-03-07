"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MatterLinkPanel({
  tenantId,
  threadId,
  linkedMatter
}: {
  tenantId: string;
  threadId: string;
  linkedMatter?: { id: string; title: string; referenceNo?: string | null } | null;
}) {
  const router = useRouter();
  const [matterId, setMatterId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    if (matterId.trim().length === 0) {
      setStatus("Matter ID zorunlu");
      return;
    }

    setPending(true);
    const response = await fetch(`/api/v1/mail/threads/${threadId}/matter`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        matterId: matterId.trim()
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: { matterTitle?: string; matterReferenceNo?: string | null };
      error?: { message: string };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Thread matter'a bağlanamadı");
      setPending(false);
      return;
    }

    const matterLabel = payload.data?.matterReferenceNo
      ? `${payload.data?.matterTitle ?? "Matter"} (${payload.data.matterReferenceNo})`
      : payload.data?.matterTitle ?? "Matter";

    setStatus(`Thread başarıyla matter'a bağlandı: ${matterLabel}`);
    setMatterId("");
    setPending(false);
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
      {status ? <p className="mt-2 text-xs text-slate-500">{status}</p> : null}
    </section>
  );
}
