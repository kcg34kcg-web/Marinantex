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
};

type GroupMemberItem = {
  contactId: string;
  email: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
};

type ContactGroupItem = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  updatedAt: string;
  members: GroupMemberItem[];
};

type GroupFormState = {
  name: string;
  description: string;
  color: string;
  contactIds: string[];
};

const EMPTY_FORM: GroupFormState = {
  name: "",
  description: "",
  color: "",
  contactIds: []
};

export function ContactGroupManagementPanel({
  tenantId,
  contacts,
  groups
}: {
  tenantId: string;
  contacts: ContactItem[];
  groups: ContactGroupItem[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [createForm, setCreateForm] = useState<GroupFormState>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<GroupFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const filteredGroups = useMemo(() => {
    const token = query.trim().toLowerCase();
    if (token.length === 0) {
      return groups;
    }

    return groups.filter((group) => {
      const groupFields = [group.name, group.description].filter((value): value is string => Boolean(value));
      const memberFields = group.members.flatMap((member) =>
        [member.email, member.fullName, member.firstName, member.lastName].filter(
          (value): value is string => Boolean(value)
        )
      );

      return [...groupFields, ...memberFields].some((value) => value.toLowerCase().includes(token));
    });
  }, [groups, query]);

  const contactsById = useMemo(() => {
    return new Map(contacts.map((contact) => [contact.id, contact]));
  }, [contacts]);

  async function submitCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreatePending(true);
    setStatus(null);

    const response = await fetch(withBasePath("/api/v1/contact-groups"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        name: createForm.name,
        ...(createForm.description.trim().length > 0 ? { description: createForm.description } : {}),
        ...(createForm.color.trim().length > 0 ? { color: createForm.color } : {}),
        contactIds: createForm.contactIds
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!response.ok || !payload.ok) {
      setStatus(payload.error?.message ?? "Kişi grubu oluşturulamadı");
      setCreatePending(false);
      return;
    }

    setCreatePending(false);
    setCreateForm(EMPTY_FORM);
    setStatus("Kişi grubu oluşturuldu");
    router.refresh();
  }

  function startEditing(group: ContactGroupItem): void {
    setEditingId(group.id);
    setEditForm({
      name: group.name,
      description: group.description ?? "",
      color: group.color ?? "",
      contactIds: group.members.map((member) => member.contactId)
    });
    setStatus(null);
  }

  async function submitUpdate(groupId: string): Promise<void> {
    setEditPending(true);
    setStatus(null);

    const response = await fetch(withBasePath(`/api/v1/contact-groups/${groupId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        name: editForm.name,
        description: editForm.description,
        ...(editForm.color.trim().length > 0 ? { color: editForm.color } : {}),
        contactIds: editForm.contactIds
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!response.ok || !payload.ok) {
      setStatus(payload.error?.message ?? "Kişi grubu güncellenemedi");
      setEditPending(false);
      return;
    }

    setEditPending(false);
    setEditingId(null);
    setStatus("Kişi grubu güncellendi");
    router.refresh();
  }

  async function deleteGroup(groupId: string): Promise<void> {
    const confirmed = window.confirm("Bu kişi grubunu silmek istediğinize emin misiniz?");
    if (!confirmed) {
      return;
    }

    setEditPending(true);
    setStatus(null);

    const response = await fetch(withBasePath(`/api/v1/contact-groups/${groupId}`), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!response.ok || !payload.ok) {
      setStatus(payload.error?.message ?? "Kişi grubu silinemedi");
      setEditPending(false);
      return;
    }

    setEditPending(false);
    setEditingId(null);
    setStatus("Kişi grubu silindi");
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Kişi Grupları</h2>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Grup ara"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-64"
        />
      </div>

      <form onSubmit={submitCreate} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
        <input
          required
          value={createForm.name}
          onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="Grup adı"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={createForm.description}
          onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
          placeholder="Açıklama"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={createForm.color}
          onChange={(event) => setCreateForm((current) => ({ ...current, color: event.target.value }))}
          placeholder="Renk (#22C55E)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={createPending}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {createPending ? "Oluşturuluyor..." : "Grup Oluştur"}
        </button>

        <label className="text-xs font-medium text-slate-700 sm:col-span-4">Gruba eklenecek kişiler</label>
        <select
          multiple
          value={createForm.contactIds}
          onChange={(event) =>
            setCreateForm((current) => ({
              ...current,
              contactIds: selectedValues(event.currentTarget.options)
            }))
          }
          className="h-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:col-span-4"
        >
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contactLabel(contact)}
            </option>
          ))}
        </select>
      </form>

      <div className="space-y-2">
        {filteredGroups.length === 0 ? (
          <p className="text-sm text-slate-600">Henüz kişi grubu yok.</p>
        ) : (
          filteredGroups.map((group) => (
            <article key={group.id} className="rounded-lg border border-slate-200 p-3">
              {editingId === group.id ? (
                <div className="grid gap-2 sm:grid-cols-4">
                  <input
                    value={editForm.name}
                    onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Grup adı"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={editForm.description}
                    onChange={(event) =>
                      setEditForm((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Açıklama"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
                  />
                  <input
                    value={editForm.color}
                    onChange={(event) => setEditForm((current) => ({ ...current, color: event.target.value }))}
                    placeholder="Renk (#22C55E)"
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />

                  <select
                    multiple
                    value={editForm.contactIds}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        contactIds: selectedValues(event.currentTarget.options)
                      }))
                    }
                    className="h-28 rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-4"
                  >
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contactLabel(contact)}
                      </option>
                    ))}
                  </select>

                  <div className="flex flex-wrap gap-2 sm:col-span-4">
                    <button
                      type="button"
                      disabled={editPending}
                      className="rounded border border-slate-300 px-3 py-1.5 text-xs"
                      onClick={() => {
                        void submitUpdate(group.id);
                      }}
                    >
                      Kaydet
                    </button>
                    <button
                      type="button"
                      disabled={editPending}
                      className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700"
                      onClick={() => {
                        void deleteGroup(group.id);
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
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">{group.name}</p>
                      {group.color ? (
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full border border-slate-300"
                          style={{ backgroundColor: group.color }}
                        />
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-slate-600">{group.description ?? "Açıklama yok"}</p>
                    <p className="truncate text-xs text-slate-500">
                      {renderMemberSummary(group.members, contactsById)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    onClick={() => startEditing(group)}
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

function selectedValues(options: HTMLOptionsCollection): string[] {
  const values: string[] = [];
  for (const option of options) {
    if (option.selected) {
      values.push(option.value);
    }
  }
  return values;
}

function contactLabel(contact: ContactItem): string {
  const resolvedName =
    contact.fullName?.trim() ||
    `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
    contact.email;
  return `${resolvedName} <${contact.email}>`;
}

function renderMemberSummary(
  members: GroupMemberItem[],
  contactsById: Map<string, ContactItem>
): string {
  if (members.length === 0) {
    return "Üye yok";
  }

  const labels = members.slice(0, 4).map((member) => {
    const fromContacts = contactsById.get(member.contactId);
    if (fromContacts) {
      return contactLabel(fromContacts);
    }
    return member.fullName?.trim() || member.email;
  });

  const suffix = members.length > 4 ? ` +${members.length - 4}` : "";
  return `${members.length} kişi: ${labels.join(", ")}${suffix}`;
}
