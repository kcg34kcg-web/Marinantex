'use client';

import { motion } from "framer-motion";
import { Scale, CheckCircle2, XCircle, ArrowRightLeft } from "lucide-react";

interface Props {
  topic: string; // Passed but often rendered in parent, kept for flexibility
  optionA: string;
  optionB: string;
  onVote: (choice: 'A' | 'B') => void;
  isVoting: boolean;
}

export default function DebateVotingView({ topic, optionA, optionB, onVote, isVoting }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-6 md:py-10 animate-in fade-in zoom-in-95 duration-500">
      
      {/* Icon */}
      <div className="bg-white p-4 rounded-full mb-6 shadow-sm border border-slate-100 relative">
        <Scale size={32} className="text-slate-400" />
        <div className="absolute -top-1 -right-1 bg-amber-500 rounded-full p-1 border-2 border-white">
             <ArrowRightLeft size={12} className="text-white" />
        </div>
      </div>
      
      <p className="text-slate-500 mb-8 font-medium text-center max-w-md text-sm">
        Sonuçları görmek, yorumları okumak ve tartışmaya katılmak için tarafını seç.
      </p>

      {/* Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
        
        {/* Option A */}
        <motion.button
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onVote('A')}
          disabled={isVoting}
          className="group relative overflow-hidden bg-white border-2 border-slate-100 hover:border-emerald-500 rounded-2xl p-6 text-left transition-all shadow-sm hover:shadow-xl hover:shadow-emerald-500/10"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-black text-emerald-600 text-xs tracking-widest bg-emerald-50 px-2 py-1 rounded">A SEÇENEĞİ</span>
            <CheckCircle2 size={20} className="text-slate-200 group-hover:text-emerald-500 transition-colors" />
          </div>
          <h3 className="text-lg font-bold text-slate-700 group-hover:text-emerald-700 transition-colors">
            {optionA}
          </h3>
        </motion.button>

        {/* Option B */}
        <motion.button
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onVote('B')}
          disabled={isVoting}
          className="group relative overflow-hidden bg-white border-2 border-slate-100 hover:border-rose-500 rounded-2xl p-6 text-left transition-all shadow-sm hover:shadow-xl hover:shadow-rose-500/10"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-black text-rose-600 text-xs tracking-widest bg-rose-50 px-2 py-1 rounded">B SEÇENEĞİ</span>
            <XCircle size={20} className="text-slate-200 group-hover:text-rose-500 transition-colors" />
          </div>
          <h3 className="text-lg font-bold text-slate-700 group-hover:text-rose-700 transition-colors">
            {optionB}
          </h3>
        </motion.button>

      </div>

      {isVoting && (
        <p className="mt-6 text-slate-400 text-xs animate-pulse font-medium">Oyunuz blok zincirine olmasa da veritabanına işleniyor...</p>
      )}
    </div>
  );
}