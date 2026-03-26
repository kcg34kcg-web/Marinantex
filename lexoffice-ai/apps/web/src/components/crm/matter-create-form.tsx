"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";

type ClientOption = {
  id: string;
  name: string;
};

export function MatterCreateForm({
  tenantId,
  clients
}: {
  tenantId: string;
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!clientId) {
      setStatus("Client seçimi zorunlu");
      return;
    }

    setPending(true);
    setStatus(null);

    const response = await fetch(withBasePath("/api/v1/matters"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        clientId,
        title,
        ...(referenceNo ? { referenceNo } : {})
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: {
        message: string;
      };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Matter oluşturulamadı");
      setPending(false);
      return;
    }

    setTitle("");
    setReferenceNo("");
    setPending(false);
    setStatus("Matter oluşturuldu");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-slate-900">Yeni Matter</h2>
      {clients.length === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Önce en az bir client oluşturmalısınız.
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          disabled={clients.length === 0}
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Matter başlığı"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={referenceNo}
          onChange={(event) => setReferenceNo(event.target.value)}
          placeholder="Referans no"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending || clients.length === 0}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Oluşturuluyor..." : "Matter Oluştur"}
      </button>
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </form>
  );
}
