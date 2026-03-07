"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("owner@demo.lexoffice.ai");
  const [password, setPassword] = useState("ChangeMe123!");
  const [tenantSlug, setTenantSlug] = useState("demo-hukuk");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password, tenantSlug })
      });

      const result = (await response.json()) as {
        ok: boolean;
        data?: { tenant: { slug: string } };
        error?: { message: string };
      };

      if (!response.ok || !result.ok || !result.data) {
        setError(result.error?.message ?? "Giriş başarısız");
        setIsPending(false);
        return;
      }

      router.push(`/${result.data.tenant.slug}/dashboard`);
      router.refresh();
    } catch {
      setError("Beklenmeyen bir hata oluştu");
      setIsPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-brand-100 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-xl backdrop-blur">
        <h1 className="text-2xl font-semibold text-slate-900">LexOffice AI Giriş</h1>
        <p className="mt-1 text-sm text-slate-600">Ofis hesabınızla giriş yapın.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            E-posta
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-500 focus:ring"
              type="email"
              required
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Şifre
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-500 focus:ring"
              type="password"
              required
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Tenant Slug
            <input
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-500 focus:ring"
              type="text"
            />
          </label>

          {error ? <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}

          <button
            disabled={isPending}
            type="submit"
            className="w-full rounded-lg bg-brand-600 px-3 py-2 text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>
      </section>
    </main>
  );
}
