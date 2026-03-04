'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getUserConversations } from '@/app/actions/chat';
import { Button } from '@/components/ui/button';

type Conversation = {
  id: string;
  updated_at?: string;
  last_message?: string;
  userInfo?: {
    full_name?: string | null;
    username?: string | null;
  };
};

interface InboxDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
}

export default function InboxDialog({ isOpen, onClose }: InboxDialogProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    getUserConversations()
      .then((data) => setConversations((data ?? []) as Conversation[]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-0">
        <div className="border-b border-slate-200 p-4">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-xl font-bold">Mesajlar</DialogTitle>
                <DialogDescription>Devam eden konuşmaların</DialogDescription>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </DialogHeader>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Yükleniyor...
            </div>
          ) : conversations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              <MessageCircle className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              Henüz konuşma yok.
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/messages/${conversation.id}`}
                  onClick={onClose}
                  className="block rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50"
                >
                  <p className="text-sm font-semibold text-slate-900">{conversation.userInfo?.full_name ?? 'Kullanıcı'}</p>
                  <p className="truncate text-xs text-slate-500">@{conversation.userInfo?.username ?? 'kullanici'}</p>
                  <p className="mt-1 truncate text-xs text-slate-600">{conversation.last_message ?? 'Yeni konuşma'}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-3">
          <Button
            className="w-full"
            onClick={() => {
              onClose();
              router.push('/messages');
            }}
          >
            Tüm Mesajlara Git
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

