'use client';

import React from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/utils/cn';

interface NotificationBellProps {
  count?: number;
  isOpen?: boolean;
  onClick?: () => void;
  className?: string;
  asDiv?: boolean;
}

export const NotificationBell = ({ 
  count = 0, 
  isOpen = false, 
  onClick,
  className,
  asDiv = false
}: NotificationBellProps) => {
  const displayCount = count > 99 ? '99+' : count;
  const Component = asDiv ? 'div' : 'button';

  return (
    <>
      <style jsx global>{`
        @keyframes bell-heavy-swing {
          0% { transform: rotate(0deg); }
          20% { transform: rotate(20deg); }
          40% { transform: rotate(-15deg); }
          60% { transform: rotate(10deg); }
          80% { transform: rotate(-5deg); }
          100% { transform: rotate(0deg); }
        }
        
        .group:hover .bell-icon-animate {
          animation: bell-heavy-swing 0.6s ease-in-out both;
          transform-origin: top center;
        }
      `}</style>

      <Component
        onClick={!asDiv ? onClick : undefined}
        type={!asDiv ? "button" : undefined}
        className={cn(
          "group relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300",
          
          // --- ARKA PLAN (Hover: Açık Turuncu) ---
          !asDiv && "hover:bg-amber-50 dark:hover:bg-slate-800",
          
          !asDiv && "active:scale-95 focus:outline-none cursor-pointer",
          className
        )}
        aria-label="Bildirimler"
      >
        {/* --- İKON --- */}
        <Bell
          className={cn(
            "bell-icon-animate w-6 h-6 transition-all duration-300",
            
            // RENK AYARI:
            // Varsayılan: Slate-600
            // Hover: Slate-900 (LACİVERT/KOYU) - Turuncu değil!
            "text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white",
            
            isOpen ? "fill-current" : "fill-none",
            "stroke-[2px]",
            "group-hover:scale-110"
          )}
        />

        {/* --- ROZET (Turuncu) --- */}
        {count > 0 && (
          <span
            className={cn(
              "absolute top-[5px] right-[5px]",
              "flex items-center justify-center",
              "min-w-[18px] h-[18px] px-[4px]",
              "bg-amber-600 text-white",
              "rounded-full text-[10px] font-bold leading-none",
              "ring-2 ring-white dark:ring-slate-950", 
              "select-none animate-in zoom-in duration-300 shadow-sm"
            )}
          >
            {displayCount}
          </span>
        )}
      </Component>
    </>
  );
};