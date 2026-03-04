'use client';

import React from 'react';
import { cn } from '@/utils/cn'; 

interface NotificationFlowerProps {
  hasUnread: boolean;
  onClick?: () => void;
  asDiv?: boolean;
}

export const NotificationFlower = ({ 
  hasUnread, 
  onClick, 
  asDiv = false 
}: NotificationFlowerProps) => {
  const Component = asDiv ? 'div' : 'button';

  return (
    <Component
      onClick={onClick}
      className={cn(
        // Twitter-style Container: Tam yuvarlak, geniş dokunma alanı, hover efekti
        "relative flex items-center justify-center w-10 h-10 rounded-full bg-transparent transition-all duration-200",
        "hover:bg-gray-100 dark:hover:bg-gray-800",
        "active:scale-95 focus:outline-none group",
        asDiv && "cursor-default"
      )}
    >
      {/* Arka Plan Parlaması (Neon Efekti) */}
      <div
        className={cn(
          "absolute inset-0 rounded-full blur-md transition-all duration-700",
          hasUnread 
            ? "bg-lexwoow-neon/20 opacity-100 scale-125 animate-pulse" 
            : "bg-transparent opacity-0 scale-50"
        )}
      />

      {/* SVG Çiçek İkonu - Boyut 24px (w-6) olarak standartlaştırıldı */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "relative z-10 w-6 h-6 transition-all duration-300",
          hasUnread 
            ? "text-lexwoow-neon drop-shadow-[0_0_8px_rgba(255,94,146,0.6)]" 
            : "text-gray-500 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white"
        )}
      >
        <path d="M12 7.5a4.5 4.5 0 1 1 4.5 4.5M12 7.5A4.5 4.5 0 1 0 7.5 12M12 7.5V9m-4.5 3a4.5 4.5 0 1 0 4.5 4.5M7.5 12H9" />
        <path d="M16.5 12A4.5 4.5 0 1 1 12 16.5M16.5 12H15" />
        <path d="M12 16.5V19" />
        <path d="M12 19a3 3 0 0 1-3 3h6a3 3 0 0 1-3-3z" />
        <path d="M12 2v5.5" />
      </svg>

      {/* Twitter-style "Cutout" Bildirim Rozeti */}
      {hasUnread && (
        <span
          className={cn(
            "absolute top-[8px] right-[8px] z-20",
            "w-[10px] h-[10px] rounded-full bg-red-500",
            // Ring-2 ve ring-background ile ikonun üzerinde yüzen temiz kesik görünümü
            "ring-2 ring-background" 
          )}
        />
      )}
    </Component>
  );
};