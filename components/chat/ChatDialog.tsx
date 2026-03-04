'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { startConversation } from '@/app/actions/chat';

interface ChatDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recipientId: string;
  recipientName: string;
  recipientAvatar?: string;
  currentUser?: { id: string | null };
}

export default function ChatDialog({
  isOpen,
  onClose,
  recipientId,
  recipientName,
  recipientAvatar,
  currentUser,
}: ChatDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleStart = () => {
    startTransition(async () => {
      try {
        const conversationId = await startConversation(recipientId);
        if (conversationId) {
          onClose();
          router.push(`/messages/${conversationId}`);
        } else {
          router.push('/messages');
        }
      } catch {
        router.push('/messages');
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0">
        <div className="p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Mesaj Başlat</DialogTitle>
            <DialogDescription>{recipientName} ile yeni bir konuşma başlat.</DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="h-10 w-10 overflow-hidden rounded-full bg-slate-200">
              {recipientAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={recipientAvatar} alt={recipientName} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{recipientName}</p>
              <p className="truncate text-xs text-slate-500">{recipientId}</p>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isPending}>
              Vazgeç
            </Button>
            <Button onClick={handleStart} disabled={isPending || !recipientId || !currentUser?.id}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
              Mesaja Git
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

