"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";

export function ClientCreateForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const response = await fetch(withBasePath("/api/v1/clients"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        name,
        ...(email ? { email } : {}),
        ...(code ? { code } : {})
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: {
        message: string;
      };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Client oluşturulamadı");
      setPending(false);
      return;
    }

    setName("");
    setEmail("");
    setCode("");
    setPending(false);
    setStatus("Client oluşturuldu");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-slate-900">Yeni Client</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Client adı"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email (opsiyonel)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Kod (opsiyonel)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Oluşturuluyor..." : "Client Oluştur"}
      </button>
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </form>
  );
}
