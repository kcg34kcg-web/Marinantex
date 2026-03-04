'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchContext } from '@/context/SearchContext';
import { motion, AnimatePresence } from 'framer-motion';

// UI Bileşenleri
import AuroraBackground from './ui/AuroraBackground';
import PulseFooter from './ui/PulseFooter';

// İkonlar
import { Brain, Quote, Wind, Gamepad2, FileText } from 'lucide-react';

// --- MODÜLLER ---
import TriviaCard from './modules/TriviaCard';
import WisdomQuote from './modules/WisdomQuote';
import ZenBreathing from './modules/ZenBreathing';
import SmartReader from './modules/SmartReader';
import MiniGame from './modules/MiniGame';

export default function LoungeContainer() {
  const router = useRouter();
  
  // 1. Global Durumu Çek
  const { isReady, searchResult } = useSearchContext();
  
  // 2. Tab Yönetimi
  const [activeTab, setActiveTab] = useState<'trivia' | 'quote' | 'zen' | 'game' | 'read'>('trivia');

  // Sonuç Sayfasına Git
  const handleComplete = () => {
    if (searchResult?.questionId) {
      router.push(`/questions/${searchResult.questionId}`);
    } else {
        router.push('/dashboard');
    }
  };

  return (
    <AuroraBackground>
      
      {/* --- 1. ÜST KISIM (Header + Menü) --- */}
      {/* Mobilde daha az yer kaplaması için margin azaltıldı */}
      <header className="flex flex-col gap-3 mb-2 md:mb-6 shrink-0 relative z-20">
        
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl font-black tracking-tighter bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Living Lounge
          </h1>
          <p className="text-indigo-300/60 text-[10px] md:text-xs font-medium tracking-widest uppercase">
            AI Analiz Merkezi
          </p>
        </div>

        {/* Tab Menüsü */}
        <nav className="flex justify-center w-full">
          <div className="flex items-center gap-1.5 bg-white/5 p-1.5 rounded-full backdrop-blur-md border border-white/10 overflow-x-auto max-w-[95vw] scrollbar-hide no-scrollbar">
            <TabButton id="trivia" icon={Brain} active={activeTab} onClick={setActiveTab} label="Bilgi" />
            <TabButton id="quote" icon={Quote} active={activeTab} onClick={setActiveTab} label="Söz" />
            <TabButton id="zen" icon={Wind} active={activeTab} onClick={setActiveTab} label="Nefes" />
            <TabButton id="read" icon={FileText} active={activeTab} onClick={setActiveTab} label="Oku" />
            <TabButton id="game" icon={Gamepad2} active={activeTab} onClick={setActiveTab} label="Oyun" />
          </div>
        </nav>
      </header>

      {/* --- 2. ORTA KISIM (MODÜLLER) --- */}
      {/* DÜZELTME: 
          - `min-h-0` ve `flex-1` ile alanın esnek olması sağlandı.
          - `max-h` kısıtlaması kaldırıldı, böylece modüller kesilmez.
          - Genişlik `max-w-2xl` yapılarak SmartReader gibi geniş modüllere yer açıldı.
      */}
      <main className="flex-1 w-full relative flex flex-col items-center justify-center z-10 px-4">
         
         <AnimatePresence mode="wait">
           <motion.div
             key={activeTab}
             initial={{ opacity: 0, y: 10, scale: 0.98 }}
             animate={{ opacity: 1, y: 0, scale: 1 }}
             exit={{ opacity: 0, y: -10, scale: 0.98 }}
             transition={{ duration: 0.3, ease: "easeOut" }}
             className="w-full max-w-xl md:max-w-2xl relative"
           >
              {/* Modüller burada render edilir */}
              {activeTab === 'trivia' && <TriviaCard />}
              {activeTab === 'quote' && <WisdomQuote />}
              {activeTab === 'zen' && <ZenBreathing />}
              {activeTab === 'read' && <SmartReader />}
              {activeTab === 'game' && <MiniGame />}
           </motion.div>
         </AnimatePresence>

      </main>

      {/* --- 3. ALT KISIM (Footer) --- */}
      <PulseFooter isReady={isReady} onComplete={handleComplete} />

    </AuroraBackground>
  );
}

// --- TAB BUTONU ---
function TabButton({ id, icon: Icon, active, onClick, label }: any) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={`relative px-3 py-2 md:px-4 md:py-2 rounded-full transition-all duration-300 flex items-center gap-2 text-xs md:text-sm font-medium shrink-0 ${
        isActive 
          ? 'text-white bg-indigo-600 shadow-lg shadow-indigo-500/30 ring-1 ring-white/20' 
          : 'text-white/50 hover:text-white hover:bg-white/10'
      }`}
    >
      <Icon size={16} className="md:w-[18px] md:h-[18px]" />
      <span>{label}</span>
      
      {/* Aktiflik Noktası */}
      {isActive && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full shadow-[0_0_5px_white]" />
      )}
    </button>
  );
}