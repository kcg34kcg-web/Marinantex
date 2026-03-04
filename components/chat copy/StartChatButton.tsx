'use client'

import { startConversation } from '@/app/actions/chat';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MessageCircle } from 'lucide-react'; // İkon
import toast from 'react-hot-toast';

export default function StartChatButton({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleStartChat = async () => {
    setLoading(true);
    try {
      // Server Action çağır
      const conversationId = await startConversation(userId);
      
      // Başarılı olursa o sayfaya git
      router.push(`/messages/${conversationId}`);
    } catch (error) {
      toast.error('Sohbet başlatılamadı.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleStartChat}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <MessageCircle size={16} />
      )}
      Mesaj Gönder
    </button>
  );
}
