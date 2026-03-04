'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type FeedComment = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type FeedPost = {
  id: string;
  postType: 'announcement' | 'short_note' | 'task_reminder' | 'file_link';
  title: string | null;
  body: string;
  caseId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    fullName: string;
    role: 'lawyer' | 'assistant';
  };
  comments: FeedComment[];
};

interface OfficeFeedPanelProps {
  activeRole: 'lawyer' | 'assistant';
}

type FeedFilter = 'all' | FeedPost['postType'];

function postTypeLabel(type: FeedPost['postType']) {
  if (type === 'announcement') return 'Duyuru';
  if (type === 'short_note') return 'Kısa Not';
  if (type === 'task_reminder') return 'Görev Hatırlatma';
  return 'Dosya Linki';
}

function postTypeChipClass(type: FeedPost['postType']) {
  if (type === 'announcement') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (type === 'task_reminder') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (type === 'file_link') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function roleLabel(role: 'lawyer' | 'assistant') {
  return role === 'lawyer' ? 'Avukat' : 'Asistan';
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'K';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function OfficeFeedPanel({ activeRole }: OfficeFeedPanelProps) {
  const [items, setItems] = useState<FeedPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [postType, setPostType] = useState<FeedPost['postType']>('short_note');
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postCaseId, setPostCaseId] = useState('');

  const [commentDraftByPostId, setCommentDraftByPostId] = useState<Record<string, string>>({});
  const [expandedCommentsByPostId, setExpandedCommentsByPostId] = useState<Record<string, boolean>>({});
  const [likedPostIds, setLikedPostIds] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<FeedFilter>('all');

  const canPublishAnnouncement = activeRole === 'lawyer';

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [items],
  );

  const filteredItems = useMemo(() => {
    if (filter === 'all') return sortedItems;
    return sortedItems.filter((item) => item.postType === filter);
  }, [sortedItems, filter]);

  const stats = useMemo(() => {
    return {
      total: items.length,
      announcements: items.filter((i) => i.postType === 'announcement').length,
      notes: items.filter((i) => i.postType === 'short_note').length,
      reminders: items.filter((i) => i.postType === 'task_reminder').length,
      files: items.filter((i) => i.postType === 'file_link').length,
      totalComments: items.reduce((acc, item) => acc + item.comments.length, 0),
    };
  }, [items]);

  async function loadFeed() {
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/office/feed/posts', { cache: 'no-store' });
      const payload = (await response.json()) as { items?: FeedPost[]; error?: string };

      if (!response.ok) {
        setStatusMessage(payload.error ?? 'Ana akış yüklenemedi.');
        return;
      }

      const nextItems = payload.items ?? [];
      setItems(nextItems);

      // Yeni gelen postlarda yorum alanını varsayılan kapalı tut (istersen true yapabiliriz)
      setExpandedCommentsByPostId((prev) => {
        const next = { ...prev };
        for (const post of nextItems) {
          if (typeof next[post.id] === 'undefined') {
            next[post.id] = post.comments.length > 0; // yorum varsa açık başlasın
          }
        }
        return next;
      });
    } catch {
      setStatusMessage('Ana akış yüklenirken ağ hatası oluştu.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadFeed().catch(() => {
      setStatusMessage('Ana akış yüklenirken ağ hatası oluştu.');
    });
  }, []);

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!postBody.trim()) {
      setStatusMessage('Gönderi metnini yazın.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/office/feed/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postType,
          title: postTitle.trim() || undefined,
          body: postBody.trim(),
          caseId: postCaseId.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusMessage(payload.error ?? 'Gönderi paylaşılamadı.');
        return;
      }

      setPostTitle('');
      setPostBody('');
      setPostCaseId('');
      await loadFeed();
      setStatusMessage('Gönderi paylaşıldı.');
    } catch {
      setStatusMessage('Gönderi paylaşılırken ağ hatası oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitComment(postId: string) {
    const draft = commentDraftByPostId[postId] ?? '';
    if (!draft.trim()) {
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/office/feed/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          body: draft.trim(),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusMessage(payload.error ?? 'Yorum kaydedilemedi.');
        return;
      }

      setCommentDraftByPostId((previous) => ({
        ...previous,
        [postId]: '',
      }));

      setExpandedCommentsByPostId((previous) => ({
        ...previous,
        [postId]: true,
      }));

      await loadFeed();
    } catch {
      setStatusMessage('Yorum gönderilirken ağ hatası oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleLike(postId: string) {
    // Şimdilik lokal UI (backend like endpoint eklenince kalıcı yapılır)
    setLikedPostIds((previous) => ({
      ...previous,
      [postId]: !previous[postId],
    }));
  }

  function toggleComments(postId: string) {
    setExpandedCommentsByPostId((previous) => ({
      ...previous,
      [postId]: !previous[postId],
    }));
  }

  const filterButtons: Array<{ key: FeedFilter; label: string }> = [
    { key: 'all', label: 'Tümü' },
    { key: 'announcement', label: 'Duyuru' },
    { key: 'short_note', label: 'Not' },
    { key: 'task_reminder', label: 'Görev' },
    { key: 'file_link', label: 'Dosya' },
  ];

  return (
    <div className="space-y-4">
      {/* Üst Composer + Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">Ofis Ana Akış</p>
            <p className="text-xs text-slate-500">
              Ekip içi duyuru, kısa not, görev hatırlatma ve dosya paylaşımları
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
              {activeRole === 'lawyer' ? 'Avukat' : 'Asistan'}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={loadFeed}
              disabled={isLoading || isSubmitting}
            >
              Yenile
            </Button>
          </div>
        </div>

        <form onSubmit={submitPost} className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <select
              value={postType}
              onChange={(event) => setPostType(event.target.value as FeedPost['postType'])}
              className="h-10 rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="short_note">Kısa Not</option>
              <option value="task_reminder">Görev Hatırlatma</option>
              <option value="file_link">Dosya Linki</option>
              <option value="announcement" disabled={!canPublishAnnouncement}>
                Duyuru {canPublishAnnouncement ? '' : '(avukat yetkisi gerekir)'}
              </option>
            </select>

            <Input
              value={postTitle}
              onChange={(event) => setPostTitle(event.target.value)}
              placeholder="Başlık (opsiyonel)"
            />

            <Input
              value={postCaseId}
              onChange={(event) => setPostCaseId(event.target.value)}
              placeholder="Case ID (opsiyonel)"
            />
          </div>

          <Textarea
            value={postBody}
            onChange={(event) => setPostBody(event.target.value)}
            placeholder="Ekip ile paylaşmak istediğiniz notu yazın..."
            className="min-h-[110px]"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {filterButtons.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={
                    filter === item.key
                      ? 'rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700'
                      : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>

            <Button type="submit" disabled={isSubmitting || !postBody.trim()}>
              {isSubmitting ? 'Paylaşılıyor...' : 'Paylaş'}
            </Button>
          </div>
        </form>
      </div>

      {statusMessage ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          {statusMessage}
        </div>
      ) : null}

      {/* Ana Layout: Feed + Sağ Sidebar */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* FEED */}
        <div className="space-y-3">
          {isLoading && filteredItems.length === 0 ? (
            <p className="text-sm text-slate-500">Ana akış yükleniyor...</p>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              {filter === 'all'
                ? 'Henüz gönderi yok. İlk gönderiyi paylaşabilirsiniz.'
                : 'Bu filtrede henüz gönderi bulunmuyor.'}
            </div>
          ) : (
            <ul className="space-y-3">
              {filteredItems.map((post) => {
                const isCommentsExpanded = expandedCommentsByPostId[post.id] ?? false;
                const isLiked = likedPostIds[post.id] ?? false;

                return (
                  <li key={post.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                          {getInitials(post.author.fullName)}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{post.author.fullName}</p>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                              {roleLabel(post.author.role)}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${postTypeChipClass(post.postType)}`}
                            >
                              {postTypeLabel(post.postType)}
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span>{new Date(post.createdAt).toLocaleString('tr-TR')}</span>
                            {post.updatedAt !== post.createdAt ? <span>• Düzenlendi</span> : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* İçerik */}
                    <div className="mt-3">
                      {post.title ? (
                        <p className="text-sm font-semibold text-slate-900">{post.title}</p>
                      ) : null}

                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.body}</p>

                      {post.caseId ? (
                        <div className="mt-3 inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                          <span className="mr-1">Bağlı Dosya:</span>
                          <Link href={`/dashboard/cases/${post.caseId}` as Route} className="font-medium underline">
                            {post.caseId}
                          </Link>
                        </div>
                      ) : null}
                    </div>

                    {/* Aksiyon Bar */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleLike(post.id)}
                          className={
                            isLiked
                              ? 'inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700'
                              : 'inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
                          }
                        >
                          {isLiked ? 'Beğenildi' : 'Beğen'}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleComments(post.id)}
                          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          {isCommentsExpanded ? 'Yorumları Gizle' : 'Yorumları Göster'}
                        </button>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>💬 {post.comments.length} yorum</span>
                        <span>{isLiked ? '👍 beğendin' : '👍 beğen'}</span>
                      </div>
                    </div>

                    {/* Yorumlar */}
                    {isCommentsExpanded ? (
                      <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Yorumlar ({post.comments.length})
                          </p>
                        </div>

                        {post.comments.length === 0 ? (
                          <p className="text-xs text-slate-500">Henüz yorum yok.</p>
                        ) : (
                          <ul className="space-y-2">
                            {post.comments.map((comment) => (
                              <li key={comment.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="font-medium text-slate-700">{comment.authorName}</p>
                                  <span className="text-[11px] text-slate-400">
                                    {new Date(comment.createdAt).toLocaleString('tr-TR')}
                                  </span>
                                </div>
                                <p className="whitespace-pre-wrap text-slate-700">{comment.body}</p>
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <Input
                            value={commentDraftByPostId[post.id] ?? ''}
                            onChange={(event) =>
                              setCommentDraftByPostId((previous) => ({
                                ...previous,
                                [post.id]: event.target.value,
                              }))
                            }
                            placeholder="Yorum yazın..."
                            disabled={isSubmitting}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={isSubmitting || !(commentDraftByPostId[post.id] ?? '').trim()}
                            onClick={() => submitComment(post.id)}
                          >
                            Yorumla
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* SAĞ SIDEBAR */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Akış Özeti</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] text-slate-500">Toplam</p>
                <p className="text-sm font-semibold text-slate-900">{stats.total}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] text-slate-500">Yorum</p>
                <p className="text-sm font-semibold text-slate-900">{stats.totalComments}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] text-slate-500">Duyuru</p>
                <p className="text-sm font-semibold text-slate-900">{stats.announcements}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] text-slate-500">Görev</p>
                <p className="text-sm font-semibold text-slate-900">{stats.reminders}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Paylaşım Tipleri</p>
            <ul className="mt-2 space-y-2 text-xs text-slate-700">
              <li className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                <span className="font-medium">Kısa Not:</span> Hızlı ekip bilgilendirmesi
              </li>
              <li className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                <span className="font-medium">Görev Hatırlatma:</span> İş akışı takibi
              </li>
              <li className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                <span className="font-medium">Dosya Linki:</span> Dosya / case bağlantısı
              </li>
              <li className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                <span className="font-medium">Duyuru:</span> Tüm ofisi ilgilendiren iletişim
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Direkt mesajlaşma için{' '}
            <Link href={'/office?tab=team' as Route} className="font-semibold underline">
              Ekibim
            </Link>{' '}
            sekmesini kullanabilirsiniz.
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Not</p>
            <p className="mt-1 text-xs text-slate-600">
              “Beğen” butonu şu anda görsel etkileşim içindir (lokal). Kalıcı beğeni için backend like endpoint’i eklenebilir.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}