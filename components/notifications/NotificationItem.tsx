'use client';

import { Notification } from '@/app/types/notification';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { Heart, MessageCircle, UserPlus, Zap, BarChart2 } from 'lucide-react';
import Image from 'next/image';

interface NotificationItemProps {
  notification: Notification;
  onRead: () => void;
}

export const NotificationItem = ({ notification, onRead }: NotificationItemProps) => {
  const router = useRouter();
  const { actor, type, created_at, is_read, resource_id, resource_type } = notification;

  // 1. Tipine Göre İkon ve Renk Seçimi
  const getIcon = () => {
    switch (type) {
      case 'like': return <Heart size={14} className="text-white fill-white" />;
      case 'comment': return <MessageCircle size={14} className="text-white fill-white" />;
      case 'follow': return <UserPlus size={14} className="text-white fill-white" />;
      case 'reply': return <MessageCircle size={14} className="text-white fill-white" />;
      default: return <Zap size={14} className="text-white" />;
    }
  };

  const getIconBgColor = () => {
    switch (type) {
      case 'like': return 'bg-red-500';
      case 'comment': case 'reply': return 'bg-blue-500';
      case 'follow': return 'bg-purple-500';
      default: return 'bg-gray-500';
    }
  };

  // 2. Tipine Göre Mesaj Metni
  const getMessage = () => {
    switch (type) {
      case 'like': return <span>gönderini beğendi.</span>;
      case 'comment': return <span>bir yorum yaptı: "..."</span>;
      case 'reply': return <span>yorumuna yanıt verdi.</span>;
      case 'follow': return <span>seni takip etmeye başladı.</span>;
      default: return <span>bir etkileşimde bulundu.</span>;
    }
  };

  // 3. Akıllı Yönlendirme (Smart Navigation)
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Parent tıklamalarını engelle
    onRead(); // Okundu işaretle

    // Yönlendirme Mantığı
    if (type === 'follow' && actor?.username) {
        router.push(`/profile/${actor.username}`);
    } else if ((type === 'like' || type === 'comment' || type === 'reply') && resource_id) {
        router.push(`/post/${resource_id}`);
    } else if (resource_type === 'poll' && resource_id) {
        router.push(`/poll/${resource_id}`);
    } else if (resource_type === 'question' && resource_id) {
        router.push(`/questions/${resource_id}`);
    }
  };

  return (
    <div 
      onClick={handleClick}
      className={`
        relative flex items-center gap-4 p-4 cursor-pointer transition-all border-b border-slate-100 last:border-none
        ${!is_read ? 'bg-blue-50/60' : 'bg-white hover:bg-slate-50'}
      `}
    >
      {/* Sol Taraf: Avatar ve İkon Rozeti */}
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 relative rounded-full overflow-hidden border border-slate-200">
           <Image 
             src={actor?.avatar_url || '/default-avatar.png'} 
             alt={actor?.username || 'User'} 
             fill 
             className="object-cover"
           />
        </div>
        {/* İkon Rozeti (Sağ Alt) */}
        <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center ${getIconBgColor()}`}>
           {getIcon()}
        </div>
      </div>

      {/* Orta Taraf: Metin */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-800 leading-snug">
          <span className="font-bold text-slate-900 mr-1">{actor?.username}</span>
          {getMessage()}
        </p>
        <p className="text-xs text-slate-400 mt-1 font-medium">
          {formatDistanceToNow(new Date(created_at), { addSuffix: true, locale: tr })}
        </p>
      </div>

      {/* Sağ Taraf: Okunmamış İşareti veya Takip Butonu */}
      {!is_read && (
        <div className="w-2.5 h-2.5 bg-blue-500 rounded-full flex-shrink-0"></div>
      )}
    </div>
  );
};