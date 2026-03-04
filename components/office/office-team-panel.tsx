'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface OfficeTeamPanelProps {
  activeRole: 'lawyer' | 'assistant';
}

type TeamMember = {
  id: string;
  fullName: string;
  role: 'lawyer' | 'assistant';
  isCurrentUser: boolean;
  isOnline?: boolean;
};

type TeamThread = {
  id: string;
  title: string | null;
  thread_type: 'direct' | 'group' | 'role' | 'broadcast';
  target_role: 'lawyer' | 'assistant' | null;
  last_message_at: string;
  member_names?: string[];
  unread_count?: number;
};

type TeamMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export function OfficeTeamPanel({ activeRole }: OfficeTeamPanelProps) {
  const canBroadcast = activeRole === 'lawyer';
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [threads, setThreads] = useState<TeamThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [composeMode, setComposeMode] = useState<'person' | 'role' | 'all'>('person');
  const [targetMemberId, setTargetMemberId] = useState('');
  const [targetRole, setTargetRole] = useState<'assistant' | 'lawyer'>('assistant');
  const [newMessage, setNewMessage] = useState('');
  const [broadcastTitle, setBroadcastTitle] = useState('Ofis Duyurusu');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const selectedThread = useMemo(
    () => threads.find((item) => item.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  const selectableMembers = useMemo(
    () => members.filter((item) => !item.isCurrentUser),
    [members],
  );

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => {
      map.set(member.id, member.fullName);
    });
    return map;
  }, [members]);

  const currentMember = useMemo(
    () => members.find((item) => item.isCurrentUser) ?? null,
    [members],
  );

  const getThreadDisplayName = (thread: TeamThread) => {
    if (thread.title?.trim()) {
      return thread.title;
    }

    if (thread.thread_type === 'direct') {
      const names = (thread.member_names ?? []).filter((name) => name.trim().length > 0);
      return names.length > 0 ? names.join(', ') : 'Bireysel Sohbet';
    }

    if (thread.thread_type === 'role') {
      return thread.target_role === 'assistant' ? 'Asistanlar Sohbeti' : 'Avukatlar Sohbeti';
    }

    if (thread.thread_type === 'broadcast') {
      return 'Ofis Yayın Sohbeti';
    }

    return 'Grup Sohbeti';
  };

  const getThreadTypeLabel = (thread: TeamThread) => {
    if (thread.thread_type === 'direct') return 'DM';
    if (thread.thread_type === 'role') return thread.target_role === 'assistant' ? '#Asistanlar' : '#Avukatlar';
    if (thread.thread_type === 'broadcast') return 'Duyuru';
    return 'Grup';
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'K';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  };

  async function loadThreads(selectNewest = false) {
    const response = await fetch('/api/office/team/threads', { cache: 'no-store' });
    const payload = (await response.json()) as { threads?: TeamThread[]; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error ?? 'Ekip sohbetleri alınamadı.');
      return;
    }

    const nextThreads = payload.threads ?? [];
    setThreads(nextThreads);

    if (nextThreads.length === 0) {
      setSelectedThreadId(null);
      setMessages([]);
      return;
    }

    if (selectNewest || !selectedThreadId || !nextThreads.some((item) => item.id === selectedThreadId)) {
      setSelectedThreadId(nextThreads[0].id);
    }
  }

  async function loadMembers() {
    const response = await fetch('/api/office/team/members', { cache: 'no-store' });
    const payload = (await response.json()) as { members?: TeamMember[]; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error ?? 'Ekip üyeleri alınamadı.');
      return;
    }

    const nextMembers = payload.members ?? [];
    setMembers(nextMembers);

    if (!targetMemberId && nextMembers.some((item) => !item.isCurrentUser)) {
      const firstOther = nextMembers.find((item) => !item.isCurrentUser);
      setTargetMemberId(firstOther?.id ?? '');
    }
  }

  async function loadMessages(threadId: string) {
    const response = await fetch(`/api/office/team/messages?threadId=${encodeURIComponent(threadId)}`, {
      cache: 'no-store',
    });
    const payload = (await response.json()) as { messages?: TeamMessage[]; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error ?? 'Mesajlar alınamadı.');
      return;
    }

    setMessages(payload.messages ?? []);
    await loadThreads();
  }

  useEffect(() => {
    async function bootstrap() {
      setIsLoading(true);
      setStatusMessage(null);

      try {
        await Promise.all([loadMembers(), loadThreads(true)]);
      } finally {
        setIsLoading(false);
      }
    }

    bootstrap().catch(() => {
      setStatusMessage('Ekip modülü başlatılamadı.');
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    loadMessages(selectedThreadId).catch(() => {
      setStatusMessage('Mesajlar yüklenemedi.');
    });
  }, [selectedThreadId]);

  async function handleCreateConversation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      if (!newMessage.trim()) {
        setStatusMessage('Gönderilecek mesajı yazın.');
        return;
      }

      if (composeMode === 'all') {
        const response = await fetch('/api/office/team/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: broadcastTitle.trim() || 'Ofis Duyurusu',
            body: newMessage.trim(),
            targetScope: 'all',
          }),
        });

        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setStatusMessage(payload.error ?? 'Tüm ofis duyurusu gönderilemedi.');
          return;
        }

        setNewMessage('');
        setStatusMessage('Duyuru tüm ofise gönderildi.');
        return;
      }

      if (composeMode === 'person' && !targetMemberId) {
        setStatusMessage('Lütfen bir ekip üyesi seçin.');
        return;
      }

      const response = await fetch('/api/office/team/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadType: composeMode === 'person' ? 'direct' : 'role',
          memberIds: composeMode === 'person' ? [targetMemberId] : undefined,
          targetRole: composeMode === 'role' ? targetRole : undefined,
          initialMessage: newMessage.trim(),
          title:
            composeMode === 'person'
              ? `DM: ${memberNameById.get(targetMemberId) ?? 'Ekip Üyesi'}`
              : composeMode === 'role'
                ? `${targetRole === 'assistant' ? 'Asistanlar' : 'Avukatlar'} Sohbeti`
                : undefined,
        }),
      });

      const payload = (await response.json()) as { threadId?: string; error?: string };
      if (!response.ok || !payload.threadId) {
        setStatusMessage(payload.error ?? 'Sohbet oluşturulamadı.');
        return;
      }

      setNewMessage('');
      setSelectedThreadId(payload.threadId);
      await loadThreads(true);
      setStatusMessage('Sohbet oluşturuldu ve mesaj gönderildi.');
    } catch {
      setStatusMessage('İşlem sırasında beklenmeyen hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function prepareDirectMessage(memberId: string) {
    setComposeMode('person');
    setTargetMemberId(memberId);
    setStatusMessage('Uye secildi. Mesajinizi yazip gonderebilirsiniz.');
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedThreadId || !messageDraft.trim()) {
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/office/team/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: selectedThreadId,
          body: messageDraft.trim(),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusMessage(payload.error ?? 'Mesaj gönderilemedi.');
        return;
      }

      setMessageDraft('');
      await Promise.all([loadMessages(selectedThreadId), loadThreads()]);
    } catch {
      setStatusMessage('Mesaj gönderilirken hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConvertMessageToTask(message: TeamMessage) {
    if (!selectedThreadId) {
      return;
    }

    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      const titleSource = message.body.trim();
      const title = titleSource.length > 80 ? `${titleSource.slice(0, 77)}...` : titleSource;

      const response = await fetch('/api/office/team/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.id,
          threadId: selectedThreadId,
          title: title.length < 3 ? 'Mesajdan oluşturulan görev' : title,
          description: message.body,
          priority: 'normal',
          assignedTo: currentMember?.id,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusMessage(payload.error ?? 'Mesaj görev olarak oluşturulamadı.');
        return;
      }

      setStatusMessage('Mesaj görev olarak oluşturuldu.');
    } catch {
      setStatusMessage('Göreve dönüştürme sırasında hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Ekip Mesajlaşma Merkezi</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Kişi, rol veya tüm ofis için akışkan iletişim paneli</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                {activeRole === 'lawyer' ? 'Avukat' : 'Asistan'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => loadThreads(true)}
                disabled={isLoading || isSubmitting}
              >
                Yenile
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ANA DÜZEN: SOL / ORTA / SAĞ */}
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
            {/* SOL PANEL: SOHBETLER */}
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-800">Sohbetler</p>
                  <p className="text-xs text-slate-500">Tüm konuşmalar</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                  {threads.length}
                </span>
              </div>

              <ul className="max-h-[680px] space-y-1.5 overflow-y-auto p-2">
                {isLoading ? (
                  <li className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">Yükleniyor...</li>
                ) : threads.length === 0 ? (
                  <li className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                    Henüz sohbet yok.
                  </li>
                ) : (
                  threads.map((thread) => {
                    const isSelected = selectedThreadId === thread.id;
                    const threadName = getThreadDisplayName(thread);

                    return (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedThreadId(thread.id)}
                          className={
                            isSelected
                              ? 'w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-left text-sm shadow-sm'
                              : 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm hover:bg-slate-50'
                          }
                        >
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-600">
                              {thread.thread_type === 'direct'
                                ? 'DM'
                                : thread.thread_type === 'role'
                                  ? '#'
                                  : thread.thread_type === 'broadcast'
                                    ? '📣'
                                    : 'G'}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate font-medium text-slate-800">{threadName}</p>
                                {(thread.unread_count ?? 0) > 0 ? (
                                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                    {thread.unread_count}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-1 flex items-center justify-between gap-2">
                                <span className="text-xs text-slate-500">{getThreadTypeLabel(thread)}</span>
                                <span className="text-[11px] text-slate-400">
                                  {new Date(thread.last_message_at).toLocaleString('tr-TR')}
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>

            {/* ORTA PANEL: MESAJLAR */}
            <div className="flex min-h-[680px] flex-col rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {selectedThread ? getThreadDisplayName(selectedThread) : 'Mesajlar'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedThread ? `${getThreadTypeLabel(selectedThread)} · ${messages.length} mesaj` : 'Bir sohbet seçin'}
                  </p>
                </div>

                {selectedThread ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    {getThreadTypeLabel(selectedThread)}
                  </span>
                ) : null}
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {!selectedThreadId ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
                      <p className="text-sm font-medium text-slate-700">Sohbet seçin</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Sol panelden bir konuşma seçerek mesajları görüntüleyin.
                      </p>
                    </div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
                      <p className="text-sm font-medium text-slate-700">Henüz mesaj yok</p>
                      <p className="mt-1 text-xs text-slate-500">Aşağıdan ilk mesajı gönderin.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((message) => {
                      const senderName = memberNameById.get(message.sender_id) ?? 'Kullanıcı';
                      const isOwnMessage = currentMember?.id === message.sender_id;

                      return (
                        <div key={message.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[86%] ${isOwnMessage ? 'items-end' : 'items-start'} flex flex-col`}>
                            <div
                              className={
                                isOwnMessage
                                  ? 'rounded-2xl rounded-br-md border border-blue-200 bg-blue-50 px-3 py-2 shadow-sm'
                                  : 'rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 shadow-sm'
                              }
                            >
                              <div className="mb-1 flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                                  {getInitials(senderName)}
                                </div>
                                <p className="text-xs font-medium text-slate-800">{senderName}</p>
                              </div>

                              <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{message.body}</p>

                              <div className="mt-1 text-right">
                                <span className="text-[11px] text-slate-400">
                                  {new Date(message.created_at).toLocaleString('tr-TR')}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleConvertMessageToTask(message)}
                              className="mt-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              disabled={isSubmitting}
                            >
                              Göreve Çevir
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <form onSubmit={handleSendMessage} className="border-t border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    placeholder={selectedThreadId ? 'Seçili sohbete mesaj yazın...' : 'Önce sohbet seçin'}
                    disabled={!selectedThreadId || isSubmitting}
                  />
                  <Button type="submit" disabled={!selectedThreadId || isSubmitting || !messageDraft.trim()}>
                    Gönder
                  </Button>
                </div>
              </form>
            </div>

            {/* SAĞ PANEL: YENİ SOHBET + EKİP + BİLGİ */}
            <div className="space-y-4">
              <form onSubmit={handleCreateConversation} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">Yeni Sohbet / Duyuru</p>
                    <p className="text-xs text-slate-500">Kişi, rol veya tüm ofise gönderim</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600">
                    {canBroadcast ? 'Yayın Yetkisi Var' : 'Yayın Yetkisi Sınırlı'}
                  </span>
                </div>

                <div className="grid gap-3">
                  <select
                    value={composeMode}
                    onChange={(event) => setComposeMode(event.target.value as 'person' | 'role' | 'all')}
                    className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="person">Kişiye Mesaj</option>
                    <option value="role">Role Mesaj</option>
                    <option value="all" disabled={!canBroadcast}>
                      Tüm Ofise Duyuru {canBroadcast ? '' : '(avukat yetkisi gerekir)'}
                    </option>
                  </select>

                  {composeMode === 'person' ? (
                    <select
                      value={targetMemberId}
                      onChange={(event) => setTargetMemberId(event.target.value)}
                      className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                    >
                      {selectableMembers.length === 0 ? <option value="">Ekip üyesi bulunamadı</option> : null}
                      {selectableMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName} ({member.role === 'assistant' ? 'Asistan' : 'Avukat'})
                        </option>
                      ))}
                    </select>
                  ) : composeMode === 'role' ? (
                    <select
                      value={targetRole}
                      onChange={(event) => setTargetRole(event.target.value as 'assistant' | 'lawyer')}
                      className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                    >
                      <option value="assistant">Asistanlar</option>
                      <option value="lawyer">Avukatlar</option>
                    </select>
                  ) : (
                    <Input
                      value={broadcastTitle}
                      onChange={(event) => setBroadcastTitle(event.target.value)}
                      placeholder="Duyuru başlığı"
                    />
                  )}

                  <Input
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    placeholder={composeMode === 'all' ? 'Tüm ofise duyuru mesajı...' : 'İlk mesajınızı yazın...'}
                    required
                  />

                  <Button type="submit" disabled={isSubmitting || isLoading} className="w-full">
                    {isSubmitting ? 'Gönderiliyor...' : 'Sohbet / Duyuru Gönder'}
                  </Button>
                </div>
              </form>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">Ekibim</p>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                    {selectableMembers.length} uye
                  </span>
                </div>

                {selectableMembers.length === 0 ? (
                  <p className="text-xs text-slate-500">Goruntulenecek baska ekip uyesi bulunamadi.</p>
                ) : (
                  <ul className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                    {selectableMembers.map((member) => (
                      <li key={member.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-600">
                                {getInitials(member.fullName)}
                                <span
                                  className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-white ${
                                    member.isOnline ? 'bg-green-500' : 'bg-slate-400'
                                  }`}
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">{member.fullName}</p>
                                <p className="text-xs text-slate-600">
                                  {member.role === 'assistant' ? 'Asistan' : 'Avukat'} ·{' '}
                                  {member.isOnline ? 'Cevrimici' : 'Cevrimdisi'}
                                </p>
                              </div>
                            </div>
                          </div>

                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => prepareDirectMessage(member.id)}
                            className="shrink-0"
                          >
                            Direkt Mesaj
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-md border border-border bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-800">Planlanan gönderim tipleri</p>
                <ul className="mt-2 space-y-2">
                  <li className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2">
                    <span>• Bireysel mesaj (1:1)</span>
                    <span className="text-xs text-slate-500">DM</span>
                  </li>
                  <li className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2">
                    <span>• Role mesaj (ör. #Asistanlar)</span>
                    <span className="text-xs text-slate-500">ROL</span>
                  </li>
                  <li className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2">
                    <span>• Tüm ofise mesaj</span>
                    <span className="text-xs text-slate-500">YAYIN</span>
                  </li>
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Bu rolde yayın yetkisi: {canBroadcast ? 'Var (tüm ofise mesaj açılacak)' : 'Sınırlı (kişi/rol mesajı)'}
                </p>
              </div>

              {statusMessage ? (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {statusMessage}
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}