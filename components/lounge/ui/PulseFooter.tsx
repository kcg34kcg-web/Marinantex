'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sparkles, BrainCircuit } from 'lucide-react';

interface PulseFooterProps {
  isReady: boolean;
  onComplete: () => void;
}

export default function PulseFooter({ isReady, onComplete }: PulseFooterProps) {
  return (
    <div className="w-full mt-auto pt-6 flex flex-col items-center justify-center relative h-24">
      <AnimatePresence mode="wait">
        
        {/* DURUM 1: HAZIR (YEŞİL BUTON) */}
        {isReady ? (
          <motion.button
            key="ready-btn"
            initial={{ scale: 0.8, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onComplete}
            className="group relative flex items-center gap-3 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-full font-bold text-lg shadow-[0_0_30px_rgba(16,185,129,0.4)] transition-all"
          >
            <Sparkles className="animate-pulse" />
            <span>Analiz Tamamlandı! Sonucu Gör</span>
            <ArrowRight className="group-hover:translate-x-1 transition-transform" />
            
            {/* Arka plandaki yanıp sönen halka */}
            <span className="absolute inset-0 rounded-full border-2 border-white/50 animate-ping opacity-20"></span>
          </motion.button>
        ) : (
          
          /* DURUM 2: DÜŞÜNÜYOR (KNIGHT RIDER BAR) */
          <motion.div
            key="loading-bar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full max-w-md flex flex-col items-center gap-3"
          >
            <div className="flex items-center gap-2 text-indigo-300 text-sm font-medium tracking-wider uppercase animate-pulse">
              <BrainCircuit size={16} />
              <span>Yapay Zeka Analiz Ediyor...</span>
            </div>

            {/* Yükleme Çubuğu Kapsayıcısı */}
            <div className="w-full h-1.5 bg-slate-800/50 rounded-full overflow-hidden relative backdrop-blur-sm border border-white/5">
              {/* Kayan Işık (Knight Rider) */}
              <motion.div
                animate={{ x: ["-100%", "100%"] }}
                transition={{ 
                  duration: 1.5, 
                  repeat: Infinity, 
                  ease: "easeInOut",
                  repeatType: "mirror" // Gidip gelme efekti
                }}
                className="w-1/2 h-full bg-gradient-to-r from-transparent via-indigo-500 to-transparent blur-[2px]"
              />
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}