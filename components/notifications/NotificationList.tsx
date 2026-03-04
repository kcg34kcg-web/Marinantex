'use client';

import { Notification } from '@/app/types/notification';
import { NotificationItem } from './NotificationItem';
import { Loader2 } from 'lucide-react';

interface NotificationListProps {
  notifications: Notification[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkRead: (id: string) => void;
}

export const NotificationList = ({ notifications, loading, hasMore, onLoadMore, onMarkRead }: NotificationListProps) => {
  
  if (loading && notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Loader2 className="animate-spin mb-2" size={24} />
        <p className="text-sm">Bildirimler yükleniyor...</p>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
           <span className="text-3xl">📭</span>
        </div>
        <h3 className="text-slate-900 font-bold text-lg">Henüz bildirim yok</h3>
        <p className="text-slate-500 text-sm mt-2 max-w-xs">
          Başkalarıyla etkileşime geçtiğinde veya paylaşımlarına yorum geldiğinde burada göreceksin.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-20 lg:pb-0">
      {notifications.map((note) => (
        <NotificationItem 
          key={note.id} 
          notification={note} 
          onRead={() => onMarkRead(note.id)} 
        />
      ))}

      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loading}
          className="w-full py-4 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-slate-50 transition-colors border-t border-slate-100 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="animate-spin" size={16} />}
          {loading ? 'Yükleniyor...' : 'Daha Eski Bildirimleri Gör'}
        </button>
      )}
    </div>
  );
};