'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCheck } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationList } from './NotificationList'; // Listenin olduğu bileşenin var olduğundan emin ol

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
}

export const NotificationDrawer = ({ isOpen, onClose, userId }: NotificationDrawerProps) => {
  const { 
    notifications, 
    loading, 
    hasMore, 
    loadMore, 
    markAsRead, 
    markAllAsRead, 
    unreadCount 
  } = useNotifications(userId);

  // Drawer açıkken arka planın kaymasını engelle (Scroll Lock)
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  // "Esc" tuşu ile kapatma
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end isolate">
          
          {/* 1. BACKDROP (Arka Plan Karartma & Blur) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm cursor-pointer"
          />

          {/* 2. DRAWER PANEL (Kayar Menü) */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="relative w-full sm:w-[480px] h-full bg-white shadow-2xl flex flex-col border-l border-slate-200"
          >
            
            {/* Header (Sabit Başlık) */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-slate-900">Bildirimler</h2>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
                    {unreadCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Tümünü Oku Butonu */}
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllAsRead()}
                    className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                    title="Tümünü okundu işaretle"
                  >
                    <CheckCheck size={20} />
                  </button>
                )}
                
                {/* Kapat Butonu */}
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            {/* İçerik (Scroll Edilebilir Alan) */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 hover:scrollbar-thumb-slate-300">
              <NotificationList 
                notifications={notifications}
                loading={loading}
                hasMore={hasMore}
                onLoadMore={loadMore}
                onMarkRead={markAsRead}
              />
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};