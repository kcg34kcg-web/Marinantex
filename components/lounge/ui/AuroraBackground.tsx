'use client';

import { motion } from 'framer-motion';
import React from 'react';

export default function AuroraBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      {/* --- ARKA PLAN EFEKTLERİ --- */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        
        {/* 1. Aurora Katmanı (Ana Renkler) */}
        <div 
          className="absolute -inset-[50%] opacity-40 blur-[80px]"
          style={{
            backgroundImage: `conic-gradient(from 0deg at 50% 50%, #1e1b4b 0deg, #312e81 60deg, #4c1d95 120deg, #581c87 180deg, #312e81 240deg, #1e1b4b 300deg)`
          }}
        />

        {/* 2. Hareketli Işık Topları (Animasyonlu) */}
        <motion.div
          animate={{
            rotate: [0, 360],
            scale: [1, 1.1, 0.9, 1]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl mix-blend-screen"
        />
        <motion.div
          animate={{
            rotate: [360, 0],
            scale: [1, 1.2, 0.8, 1]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-violet-500/20 rounded-full blur-3xl mix-blend-screen"
        />

        {/* 3. Grid Dokusu (Teknoloji Hissi) */}
        <div className="bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
        
      </div>

      {/* --- İÇERİK KAPSAYICISI (Z-Index ile öne çıkarıldı) --- */}
      <div className="relative z-10 w-full max-w-5xl px-4 flex flex-col h-screen py-6 md:py-12">
        {children}
      </div>

    </div>
  );
}