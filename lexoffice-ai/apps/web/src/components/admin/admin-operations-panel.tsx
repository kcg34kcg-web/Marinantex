"use client";

import { useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";

type MemberRow = {
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  roleCode: string;
  roleName: string;
  invitedAt: string | null;
  joinedAt: string | null;
  isCurrentUser: boolean;
};

type RoleRow = {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  permissionCodes: string[];
};

type SystemLogRow = {
  id: string;
  type: "AUDIT" | "SECURITY";
  actionOrEvent: string;
  severity: string | null;
  actor: string;
  createdAt: string;
};

type InviteState = {
  email: string;
  firstName: string;
  lastName: string;
  roleCode: string;
};

export function AdminOperationsPanel({
  tenantId,
  members,
  roles,
  systemLogs,
  errorLogs
}: {
  tenantId: string;
  members: MemberRow[];
  roles: RoleRow[];
  systemLogs: SystemLogRow[];
  errorLogs: SystemLogRow[];
}) {
  const [invite, setInvite] = useState<InviteState>({
    email: "",
    firstName: "",
    lastName: "",
    roleCode: roles[0]?.code ?? "lawyer"
  });
  const [invitePending, setInvitePending] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [selectedRoleByMember, setSelectedRoleByMember] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((member) => [member.id, member.roleCode]))
  );

  const roleOptions = useMemo(
    () =>
      roles.map((role) => ({
        code: role.code,
        label: `${role.name} (${role.code})`
      })),
    [roles]
  );

  async function inviteMember(): Promise<void> {
    if (!invite.email.trim()) {
      setInviteStatus("E-posta zorunlu");
      return;
    }

    setInvitePending(true);
    setInviteStatus(null);

    const response = await fetch(withBasePath("/api/v1/members/invite"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        email: invite.email.trim(),
        firstName: invite.firstName.trim(),
        lastName: invite.lastName.trim(),
        roleCode: invite.roleCode
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setInviteStatus(payload.error?.message ?? "Kullanıcı davet edilemedi");
      setInvitePending(false);
      return;
    }

    setInviteStatus("Kullanıcı davet edildi");
    window.location.reload();
  }

  async function updateRole(membershipId: string): Promise<void> {
    const roleCode = selectedRoleByMember[membershipId];
    if (!roleCode) {
      setActionStatus("Geçerli bir rol seçin");
      return;
    }

    setPendingMemberId(membershipId);
    setActionStatus(null);

    const response = await fetch(withBasePath(`/api/v1/admin/members/${encodeURIComponent(membershipId)}/role`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        roleCode
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setActionStatus(payload.error?.message ?? "Rol güncellenemedi");
      setPendingMemberId(null);
      return;
    }

    setActionStatus("Rol güncellendi");
    window.location.reload();
  }

  async function deactivateMember(membershipId: string): Promise<void> {
    setPendingMemberId(membershipId);
    setActionStatus(null);

    const response = await fetch(
      withBasePath(`/api/v1/admin/members/${encodeURIComponent(membershipId)}/deactivate`),
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId
      })
      }
    );

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setActionStatus(payload.error?.message ?? "Kullanıcı pasifleştirilemedi");
      setPendingMemberId(null);
      return;
    }

    setActionStatus("Kullanıcı pasifleştirildi");
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Kullanıcı Yönetimi</h2>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={invite.email}
            onChange={(event) => setInvite((prev) => ({ ...prev, email: event.target.value }))}
            placeholder="E-posta"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={invite.firstName}
            onChange={(event) => setInvite((prev) => ({ ...prev, firstName: event.target.value }))}
            placeholder="Ad"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={invite.lastName}
            onChange={(event) => setInvite((prev) => ({ ...prev, lastName: event.target.value }))}
            placeholder="Soyad"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={invite.roleCode}
            onChange={(event) => setInvite((prev) => ({ ...prev, roleCode: event.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {roleOptions.map((role) => (
              <option key={role.code} value={role.code}>
                {role.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={invitePending}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
          onClick={() => {
            void inviteMember();
          }}
        >
          {invitePending ? "Davet gönderiliyor..." : "Kullanıcı Davet Et"}
        </button>
        {inviteStatus ? <p className="text-xs text-slate-600">{inviteStatus}</p> : null}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">Kullanıcı</th>
                <th className="px-3 py-2">Durum</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">
                      {[member.firstName, member.lastName].filter(Boolean).join(" ").trim() || member.email}
                      {member.isCurrentUser ? " (Siz)" : ""}
                    </p>
                    <p className="text-slate-500">{member.email}</p>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{member.status}</td>
                  <td className="px-3 py-2">
                    <select
                      value={selectedRoleByMember[member.id] ?? member.roleCode}
                      onChange={(event) =>
                        setSelectedRoleByMember((prev) => ({
                          ...prev,
                          [member.id]: event.target.value
                        }))
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      {roleOptions.map((role) => (
                        <option key={role.code} value={role.code}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingMemberId === member.id}
                        className="rounded border border-slate-300 px-2 py-1"
                        onClick={() => {
                          void updateRole(member.id);
                        }}
                      >
                        Rol Güncelle
                      </button>
                      {!member.isCurrentUser ? (
                        <button
                          type="button"
                          disabled={pendingMemberId === member.id}
                          className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-700"
                          onClick={() => {
                            void deactivateMember(member.id);
                          }}
                        >
                          Pasifleştir
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {actionStatus ? <p className="text-xs text-slate-600">{actionStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Rol ve Yetki Yönetimi</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <article key={role.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-800">
                {role.name} <span className="text-slate-500">({role.code})</span>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{role.isSystem ? "Sistem rolü" : "Tenant rolü"}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {role.permissionCodes.map((permissionCode) => (
                  <span key={permissionCode} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                    {permissionCode}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Sistem Logları</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">Tip</th>
                <th className="px-3 py-2">Olay</th>
                <th className="px-3 py-2">Seviye</th>
                <th className="px-3 py-2">Aktör</th>
                <th className="px-3 py-2">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {systemLogs.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.type}</td>
                  <td className="px-3 py-2">{row.actionOrEvent}</td>
                  <td className="px-3 py-2">{row.severity ?? "-"}</td>
                  <td className="px-3 py-2">{row.actor}</td>
                  <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString("tr-TR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-rose-900">Hata Logları</h2>
        <div className="overflow-x-auto rounded-lg border border-rose-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-rose-50 text-rose-800">
              <tr>
                <th className="px-3 py-2">Tip</th>
                <th className="px-3 py-2">Olay</th>
                <th className="px-3 py-2">Seviye</th>
                <th className="px-3 py-2">Aktör</th>
                <th className="px-3 py-2">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {errorLogs.length === 0 ? (
                <tr>
                  <td className="px-3 py-2 text-slate-500" colSpan={5}>
                    Son 7 günde kritik hata kaydı bulunamadı.
                  </td>
                </tr>
              ) : (
                errorLogs.map((row) => (
                  <tr key={row.id} className="border-t border-rose-100">
                    <td className="px-3 py-2">{row.type}</td>
                    <td className="px-3 py-2">{row.actionOrEvent}</td>
                    <td className="px-3 py-2">{row.severity ?? "-"}</td>
                    <td className="px-3 py-2">{row.actor}</td>
                    <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString("tr-TR")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
