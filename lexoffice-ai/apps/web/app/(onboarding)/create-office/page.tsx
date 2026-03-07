"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateOfficePage() {
  const router = useRouter();
  const [name, setName] = useState("Yeni Hukuk Ofisi");
  const [slug, setSlug] = useState("yeni-hukuk-ofisi");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsPending(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, slug })
      });

      const result = (await response.json()) as {
        ok: boolean;
        data?: { slug: string };
        error?: { message: string };
      };

      if (!response.ok || !result.ok || !result.data) {
        setError(result.error?.message ?? "Ofis oluşturulamadı");
        setIsPending(false);
        return;
      }

      router.push(`/${result.data.slug}/dashboard`);
    } catch {
      setError("Beklenmeyen bir hata oluştu");
      setIsPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Ofis Oluştur</h1>
        <p className="mt-1 text-sm text-slate-600">Tenant kaydı için temel bilgileri girin.</p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium text-slate-700">
            Ofis Adı
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              required
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Slug
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              required
            />
          </label>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <button
            disabled={isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
            type="submit"
          >
            {isPending ? "Oluşturuluyor..." : "Ofisi Oluştur"}
          </button>
        </form>
      </section>
    </main>
  );
}
