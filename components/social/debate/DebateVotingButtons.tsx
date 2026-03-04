'use client';

import { useState } from "react";
import { cn } from "@/utils/cn";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion"; // Animasyon için (yoksa npm install framer-motion)

interface VotingProps {
  stats: { a: number; b: number; total: number };
  userVote: 'A' | 'B' | null;
  onVote: (side: 'A' | 'B') => void;
  isPending: boolean;
}

export default function DebateVotingButtons({ stats, userVote, onVote, isPending }: VotingProps) {
  // Yüzdeleri hesapla (0'a bölme hatasını önle)
  const total = stats.a + stats.b;
  const percentA = total > 0 ? Math.round((stats.a / total) * 100) : 0;
  const percentB = total > 0 ? Math.round((stats.b / total) * 100) : 0;

  // Oy verilip verilmediğini kontrol et
  const hasVoted = !!userVote;

  return (
    <div className="flex gap-3 w-full mt-4 mb-6">
      
      {/* --- A TARAFI (KATILIYORUM) BUTONU --- */}
      <button
        onClick={() => onVote('A')}
        disabled={isPending}
        className={cn(
          "relative flex-1 h-12 rounded-xl overflow-hidden transition-all duration-300 group",
          // Temel stil (Border ve Renkler)
          hasVoted 
            ? "border-emerald-600/20 bg-emerald-50" // Oy verildikten sonra zemin
            : "border-2 border-emerald-100 bg-white hover:border-emerald-500 hover:bg-emerald-50" // Oy vermeden önce
        )}
      >
        {/* DOLULUK ÇUBUĞU (PROGRESS BAR) - Sadece oy verildiyse görünür */}
        {hasVoted && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentA}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="absolute top-0 left-0 h-full bg-emerald-500/20 border-r border-emerald-500/30"
          />
        )}

        {/* METİN VE YÜZDE */}
        <div className="relative z-10 flex items-center justify-center w-full h-full gap-2">
            {isPending && userVote === 'A' ? (
                <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
            ) : (
                <span className={cn(
                    "font-bold uppercase tracking-wide transition-all",
                    hasVoted ? "text-emerald-800 text-sm" : "text-emerald-600 text-base"
                )}>
                    KATILIYORUM
                    {/* Yüzde, sadece oy verildikten sonra belirir */}
                    {hasVoted && <span className="ml-1 opacity-100">({percentA}%)</span>}
                </span>
            )}
        </div>
      </button>


      {/* --- B TARAFI (KATILMIYORUM) BUTONU --- */}
      <button
        onClick={() => onVote('B')}
        disabled={isPending}
        className={cn(
          "relative flex-1 h-12 rounded-xl overflow-hidden transition-all duration-300 group",
          hasVoted 
            ? "border-rose-600/20 bg-rose-50" 
            : "border-2 border-rose-100 bg-white hover:border-rose-500 hover:bg-rose-50"
        )}
      >
        {/* DOLULUK ÇUBUĞU */}
        {hasVoted && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentB}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="absolute top-0 left-0 h-full bg-rose-500/20 border-r border-rose-500/30"
          />
        )}

        {/* METİN */}
        <div className="relative z-10 flex items-center justify-center w-full h-full gap-2">
            {isPending && userVote === 'B' ? (
                <Loader2 className="w-5 h-5 animate-spin text-rose-600" />
            ) : (
                <span className={cn(
                    "font-bold uppercase tracking-wide transition-all",
                    hasVoted ? "text-rose-800 text-sm" : "text-rose-600 text-base"
                )}>
                    KATILMIYORUM
                    {hasVoted && <span className="ml-1 opacity-100">({percentB}%)</span>}
                </span>
            )}
        </div>
      </button>

    </div>
  );
}