'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ChevronRight, RefreshCw } from 'lucide-react';

// ✅ DOĞRU IMPORT: data.ts dosyasından veriyi çeker
// Eğer TypeScript 'Article' bulunamadı derse, data.ts dosyanızda "export interface Article..." olduğundan emin olun.
import { ARTICLE_DATA, Article } from '@/data';

// --- YARDIMCI FONKSİYON: KARIŞTIRMA (SHUFFLE) ---
function shuffleArray(array: Article[]) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// ⚠️ DÜZELTME BURADA: LoungeContainer ile uyum için "export default function" yapıldı
export default function SmartReader() {
  // Başlangıçta boş array ile başla, useEffect'te doldur (Hydration hatasını önler)
  const [readingList, setReadingList] = useState<Article[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sayfa yüklendiğinde listeyi karıştır
  useEffect(() => {
    // ARTICLE_DATA var mı kontrol et, yoksa boş dizi kullan
    const data = ARTICLE_DATA || [];
    setReadingList(shuffleArray(data));
    setIsMounted(true);
  }, []);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const totalScroll = scrollHeight - clientHeight;
      const currentProgress = (scrollTop / totalScroll) * 100;
      setProgress(currentProgress);
    }
  };

  const handleNext = () => {
    if (activeIndex === readingList.length - 1) {
        setReadingList(shuffleArray(ARTICLE_DATA || [])); // Liste bitince yeniden karıştır
        setActiveIndex(0);
    } else {
        setActiveIndex((prev) => prev + 1);
    }
    setProgress(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // 🚀 PERFORMANS İÇİN SKELETON EKRANI (Yavaşlık hissini yok eder)
  if (!isMounted || readingList.length === 0) {
    return (
      <div className="w-full h-[400px] bg-slate-900/50 rounded-3xl border border-white/10 relative overflow-hidden flex flex-col shadow-2xl backdrop-blur-md animate-pulse">
        <div className="p-4 border-b border-white/5 bg-white/5">
           <div className="h-4 w-20 bg-slate-700/50 rounded mb-2"></div>
           <div className="h-6 w-3/4 bg-slate-700/50 rounded mb-2"></div>
           <div className="h-3 w-1/2 bg-slate-800/50 rounded"></div>
        </div>
        <div className="p-6 space-y-4">
           <div className="h-3 w-full bg-slate-800/50 rounded"></div>
           <div className="h-3 w-full bg-slate-800/50 rounded"></div>
           <div className="h-3 w-2/3 bg-slate-800/50 rounded"></div>
        </div>
      </div>
    );
  }

  const article = readingList[activeIndex];

  // Hata koruması: Eğer makale yoksa boş dön
  if (!article) return null;

  return (
    <div className="w-full h-[400px] bg-slate-900/50 rounded-3xl border border-white/10 relative overflow-hidden flex flex-col shadow-2xl backdrop-blur-md">
      
      {/* HEADER */}
      <div className="absolute top-0 left-0 w-full z-20 bg-slate-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="p-4 flex justify-between items-start">
           <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block font-bold">
                {article.category}
              </span>
              <h3 className="text-white font-bold text-lg leading-tight">{article.title}</h3>
              <p className="text-blue-400 text-xs font-medium mt-1">{article.subtitle}</p>
           </div>
           <div className="flex items-center gap-1 text-xs text-slate-500 bg-white/5 px-2 py-1 rounded-lg">
              <Clock size={12} /> {article.readTime}
           </div>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full h-1 bg-slate-800">
           <motion.div 
             className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
             style={{ width: `${progress}%` }}
             layoutId="progress"
           />
        </div>
      </div>

      {/* CONTENT */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6 pt-28 scroll-smooth scrollbar-hide"
      >
        <AnimatePresence mode='wait'>
            <motion.div
            key={article.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="prose prose-invert prose-sm max-w-none"
            >
            <div 
                className="text-slate-300 leading-relaxed text-sm font-light tracking-wide"
                dangerouslySetInnerHTML={{ __html: article.content }} 
            />
            
            <div className="mt-8 p-4 bg-blue-500/10 rounded-xl border border-blue-500/20 text-center">
                <p className="text-blue-200 text-xs font-bold">🎉 Okumayı Tamamladınız</p>
            </div>
            <div className="h-10"></div> 
            </motion.div>
        </AnimatePresence>
      </div>

      {/* FOOTER CONTROLS */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-3">
         <span className="text-[10px] text-slate-500 font-mono bg-black/20 px-2 py-1 rounded-md backdrop-blur-sm">
            {activeIndex + 1} / {readingList.length}
         </span>
         <button 
           onClick={handleNext}
           className="group flex items-center gap-2 bg-white text-slate-900 px-4 py-2 rounded-full font-bold text-xs shadow-lg hover:bg-blue-50 transition-all hover:scale-105 active:scale-95"
         >
            {activeIndex === readingList.length - 1 ? "Yeniden Başla" : "Sıradaki"}
            {activeIndex === readingList.length - 1 ? <RefreshCw size={14}/> : <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform"/>}
         </button>
      </div>

    </div>
  );
}