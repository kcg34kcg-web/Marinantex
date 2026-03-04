'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationBell } from './NotificationBell'; // ✅ Yeni Bileşen
import { NotificationList } from './NotificationList';
import { X, CheckCheck } from 'lucide-react';

// Dışarı tıklama hook'u
function useOutsideClick(ref: React.RefObject<HTMLDivElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}

interface NotificationPopoverProps {
  userId?: string;
  align?: 'left' | 'right';
  label?: string;
}

export const NotificationPopover = ({ userId, align = 'right', label }: NotificationPopoverProps) => {
  const { 
    notifications, 
    unreadCount, 
    loading, 
    hasMore, 
    loadMore, 
    markAsRead, 
    markAllAsRead 
  } = useNotifications(userId);

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useOutsideClick(containerRef, () => setIsOpen(false));

  // Mobilde scroll'u kilitle
  useEffect(() => {
    if (isOpen && window.innerWidth < 1024) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block">
      
      {/* --- TETİKLEYİCİ (TRIGGER) --- */}
      {/* DÜZELTME: Bell zaten bir buton olduğu için wrapper 'div' yapıldı */}
      <div className={`flex items-center gap-4 group ${label ? 'w-full' : ''}`}>
         
         <NotificationBell 
            count={unreadCount} 
            isOpen={isOpen} 
            onClick={() => setIsOpen(!isOpen)} 
         />

         {/* Eğer Sidebar'da kullanılıyorsa etiket (Label) buraya gelir */}
         {label && (
           <button 
             onClick={() => setIsOpen(!isOpen)}
             className="text-xl font-bold text-slate-600 group-hover:text-slate-900 transition-colors focus:outline-none"
           >
             {label}
           </button>
         )}
      </div>

      {/* --- AÇILIR PENCERE (POPOVER / DRAWER) --- */}
      {isOpen && (
        <>
          {/* MOBİL BACKDROP */}
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[90] lg:hidden" onClick={() => setIsOpen(false)} />

          <div 
            className={`
                bg-white dark:bg-slate-900 shadow-2xl z-[100] flex flex-col
                border border-slate-100 dark:border-slate-800
                
                /* MOBİL: Bottom Sheet */
                fixed inset-x-0 bottom-0 top-[10%] rounded-t-2xl
                lg:top-auto lg:bottom-auto lg:inset-auto 
                
                /* MASAÜSTÜ: Dropdown */
                lg:absolute lg:mt-3 lg:w-[400px] lg:rounded-2xl
                ${align === 'left' ? 'lg:left-0' : 'lg:right-0'}

                animate-in slide-in-from-bottom-10 lg:zoom-in-95 duration-200
            `}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 rounded-t-2xl">
              <h3 className="text-slate-900 dark:text-white font-bold text-lg flex items-center gap-2">
                Bildirimler
                {unreadCount > 0 && (
                   <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">{unreadCount}</span>
                )}
              </h3>
              
              <div className="flex items-center gap-2">
                 {unreadCount > 0 && (
                    <button 
                        onClick={() => markAllAsRead()}
                        title="Tümünü okundu işaretle"
                        className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-colors"
                    >
                        <CheckCheck size={20} />
                    </button>
                 )}
                 
                 <button 
                    onClick={() => setIsOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full lg:hidden"
                 >
                    <X size={24} />
                 </button>
              </div>
            </div>

            {/* Liste Alanı */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700 lg:max-h-[500px]">
               <NotificationList 
                 notifications={notifications}
                 loading={loading}
                 hasMore={hasMore}
                 onLoadMore={loadMore}
                 onMarkRead={markAsRead}
               />
            </div>
          </div>
        </>
      )}
    </div>
  );
};