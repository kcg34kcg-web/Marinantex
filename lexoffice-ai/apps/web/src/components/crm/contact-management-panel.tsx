"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";

type ContactItem = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  company: string | null;
  title: string | null;
  notes: string | null;
  updatedAt: string;
};

type ContactFormState = {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  notes: string;
};

const EMPTY_FORM: ContactFormState = {
  fullName: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  title: "",
  notes: ""
};

export function ContactManagementPanel({
  tenantId,
  contacts
}: {
  tenantId: string;
  contacts: ContactItem[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [createForm, setCreateForm] = useState<ContactFormState>(EMPTY_FORM);
  const [createPending, setCreatePending] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ContactFormState>(EMPTY_FORM);
  const [status, setStatus] = useState<string | null>(null);

  const filteredContacts = useMemo(() => {
    const token = query.trim().toLowerCase();
    if (token.length === 0) {
      return contacts;
    }

    return contacts.filter((contact) =>
      [
        contact.fullName,
        contact.firstName,
        contact.lastName,
        contact.email,
        contact.company,
        contact.title,
        contact.phone
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(token))
    );
  }, [contacts, query]);

  async function submitCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreatePending(true);
    setStatus(null);

    const response = await fetch(withBasePath("/api/v1/contacts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        email: createForm.email,
        ...(createForm.fullName ? { fullName: createForm.fullName } : {}),
        ...(createForm.firstName ? { firstName: createForm.firstName } : {}),
        ...(createForm.lastName ? { lastName: createForm.lastName } : {}),
        ...(createForm.phone ? { phone: createForm.phone } : {}),
        ...(createForm.company ? { company: createForm.company } : {}),
        ...(createForm.title ? { title: createForm.title } : {}),
        ...(createForm.notes ? { notes: createForm.notes } : {})
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!response.ok || !payload.ok) {
      setStatus(payload.error?.message ?? "Kişi oluşturulamadı");
      setCreatePending(false);
      return;
    }

    setCreateForm(EMPTY_FORM);
    setCreatePending(false);
    setStatus("Kişi eklendi");
    router.refresh();
  }

  function startEditing(contact: ContactItem): void {
    setEditingId(contact.id);
    setEditForm({
      fullName: contact.fullName ?? "",
      firstName: contact.firstName ?? "",
      lastName: contact.lastName ?? "",
      email: contact.email,
      phone: contact.phone ?? "",
      company: contact.company ?? "",
      title: contact.title ?? "",
      notes: contact.notes ?? ""
    });
    setStatus(null);
  }

  async function submitUpdate(contactId: string): Promise<void> {
    setEditPending(true);
    setStatus(null);

    const response = await fetch(withBasePath(`/api/v1/contacts/${contactId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        email: editForm.email,
        fullName: editForm.fullName,
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        phone: editForm.phone,
        company: editForm.company,
        title: editForm.title,
        notes: editForm.notes
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!response.ok || !payload.ok) {
      setStatus(payload.error?.message ?? "Kişi güncellenemedi");
      setEditPending(false);
      return;
    }

    setEditingId(null);
    setEditPending(false);
    setStatus("Kişi güncellendi");
    router.refresh();
  }

  async function deleteContact(contactId: string): Promise<void> {
    const confirmed = window.confirm("Bu kişiyi silmek istediğinize emin misiniz?");
    if (!confirmed) {
      return;
    }

    setEditPending(true);
    setStatus(null);

    const response = await fetch(withBasePath(`/api/v1/contacts/${contactId}`), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!response.ok || !payload.ok) {
      setStatus(payload.error?.message ?? "Kişi silinemedi");
      setEditPending(false);
      return;
    }

    setEditingId(null);
    setEditPending(false);
    setStatus("Kişi silindi");
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Kişi Yönetimi</h2>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Kişi ara"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-64"
        />
      </div>

      <form onSubmit={submitCreate} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
        <input
          value={createForm.fullName}
          onChange={(event) => setCreateForm((current) => ({ ...current, fullName: event.target.value }))}
          placeholder="Ad Soyad"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="email"
          value={createForm.email}
          onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
          placeholder="Email"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={createForm.phone}
          onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))}
          placeholder="Telefon"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={createPending}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {createPending ? "Ekleniyor..." : "Kişi Ekle"}
        </button>
      </form>

      <div className="space-y-2">
        {filteredContacts.length === 0 ? (
          <p className="text-sm text-slate-600">Kişi bulunamadı.</p>
        ) : (
          filteredContacts.map((contact) => (
            <article key={contact.id} className="rounded-lg border border-slate-200 p-3">
              {editingId === contact.id ? (
                <div className="grid gap-2 sm:grid-cols-4">
                  <input
                    value={editForm.fullName}
                    onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))}
                    placeholder="Ad Soyad"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="Email"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={editForm.phone}
                    onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))}
                    placeholder="Telefon"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={editForm.company}
                    onChange={(event) => setEditForm((current) => ({ ...current, company: event.target.value }))}
                    placeholder="Şirket"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={editForm.title}
                    onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ünvan"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <textarea
                    value={editForm.notes}
                    onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Notlar"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-3"
                  />
                  <div className="sm:col-span-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={editPending}
                      className="rounded border border-slate-300 px-3 py-1.5 text-xs"
                      onClick={() => {
                        void submitUpdate(contact.id);
                      }}
                    >
                      Kaydet
                    </button>
                    <button
                      type="button"
                      disabled={editPending}
                      className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700"
                      onClick={() => {
                        void deleteContact(contact.id);
                      }}
                    >
                      Sil
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-3 py-1.5 text-xs"
                      onClick={() => setEditingId(null)}
                    >
                      Vazgeç
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {contact.fullName ?? contact.email}
                    </p>
                    <p className="truncate text-xs text-slate-600">{contact.email}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[contact.phone, contact.company, contact.title].filter(Boolean).join(" • ") || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    onClick={() => startEditing(contact)}
                  >
                    Düzenle
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </div>

      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </section>
  );
}
