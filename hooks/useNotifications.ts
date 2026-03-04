// app/hooks/useNotifications.ts

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client'; 
import { Notification } from '@/app/types/notification'; // Senin yeni oluşturduğun dosya

const PAGE_SIZE = 10;

export const useNotifications = (userId: string | undefined) => {
  const supabase = useMemo(() => createClient(), []);
  
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const pageRef = useRef(0);

  // 1. Unread Badge Logic (Sadece sayıyı getirir - Hafif Sorgu)
  const fetchUnreadCount = useCallback(async () => {
    if (!userId) return;

    // head: true veriyi çekmez, sadece sayar (count: 'exact')
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true }) 
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (!error && count !== null) {
      setUnreadCount(count);
    }
  }, [userId, supabase]);

  // 2. Bildirimleri Getirme (Pagination Dahil)
  const fetchNotifications = useCallback(async (isLoadMore = false) => {
    if (!userId) return;
    
    try {
      if (!isLoadMore) setLoading(true);

      const from = pageRef.current * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Actor verisini JOIN ile çekiyoruz (profiles tablosu)
      const { data, error } = await supabase
        .from('notifications')
        .select(`
          *,
          actor:profiles!actor_id (
            username,
            avatar_url
          )
        `)
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      if (data) {
        // Gelen veriyi Notification tipine zorlayarak kullanıyoruz
        const fetchedNotes = data as unknown as Notification[];

        setNotifications(prev => isLoadMore ? [...prev, ...fetchedNotes] : fetchedNotes);
        
        // Eğer gelen veri sayısı sayfa boyutundan azsa, daha fazla veri yok demektir
        if (fetchedNotes.length < PAGE_SIZE) {
          setHasMore(false);
        }
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [userId, supabase]);

  // Sayfa yüklendiğinde çalışacak ana efekt
  useEffect(() => {
    if (!userId) return;

    // İlk yükleme
    fetchNotifications();
    fetchUnreadCount();

    // 3. Real-time Subscription (Canlı Takip)
    const channel = supabase
      .channel('realtime-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        async (payload) => {
          // Yeni bildirim geldiğinde tetiklenir
          const newId = payload.new.id;

          // Yeni bildirimin detaylarını (actor bilgisiyle) çek
          const { data, error } = await supabase
            .from('notifications')
            .select(`
              *,
              actor:profiles!actor_id (
                username,
                avatar_url
              )
            `)
            .eq('id', newId)
            .single();

          if (!error && data) {
            const newNotification = data as unknown as Notification;
            
            // Listeye en başa ekle
            setNotifications((prev) => [newNotification, ...prev]);
            // Okunmamış sayısını artır
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchNotifications, fetchUnreadCount, supabase]);

  // 4. Load More (Infinite Scroll için)
  const loadMore = () => {
    if (!hasMore || loading) return;
    pageRef.current += 1;
    fetchNotifications(true);
  };

  // 5. Mark as Read (Optimistic Update)
  const markAsRead = async (notificationId: string) => {
    // A) Optimistic Update: UI'ı hemen güncelle
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId ? { ...n, is_read: true } : n
      )
    );
    
    // Okunmamış sayısını yerel olarak düşür
    setUnreadCount((prev) => Math.max(0, prev - 1));

    // B) Server Update: Arka planda veritabanını güncelle
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);
  };

  // Tümünü okundu işaretle
  const markAllAsRead = async () => {
    if (!userId) return;

    // Optimistic
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);
  };

  return {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadMore,
    markAsRead,
    markAllAsRead
  };
};
