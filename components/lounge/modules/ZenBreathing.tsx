'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wind, Play, Pause, Settings2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/utils/cn';

// --- TİP TANIMLAMALARI ---
type BreathPhase = 'inhale' | 'hold-in' | 'exhale' | 'hold-out';

interface BreathingPattern {
  id: string;
  name: string;
  description: string;
  cycle: {
    inhale: number;
    'hold-in': number;
    exhale: number;
    'hold-out': number;
  };
}

// --- BİLİMSEL NEFES TEKNİKLERİ ---
const PATTERNS: BreathingPattern[] = [
  {
    id: 'box',
    name: '',
    description: 'Odaklanma ve stres yönetimi için idealdir.',
    cycle: { inhale: 4000, 'hold-in': 4000, exhale: 4000, 'hold-out': 4000 }
  },
  {
    id: 'relax',
    name: '4-7-8 Tekniği',
    description: 'Derin rahatlama ve uykuya geçişi kolaylaştırır.',
    cycle: { inhale: 4000, 'hold-in': 7000, exhale: 8000, 'hold-out': 0 }
  },
  {
    id: 'balance',
    name: 'Denge (Coherent)',
    description: 'Kalp ritmini düzenler, zihni sakinleştirir.',
    cycle: { inhale: 5500, 'hold-in': 0, exhale: 5500, 'hold-out': 0 }
  }
];

// Phase Konfigürasyonları (Renk ve Metinler)
const PHASE_CONFIG: Record<BreathPhase, { label: string; color: string; scale: number }> = {
  'inhale':    { label: "Nefes Al",    color: "from-emerald-400 to-teal-300", scale: 1.5 },
  'hold-in':   { label: "Tut",         color: "from-emerald-500 to-teal-400", scale: 1.5 },
  'exhale':    { label: "Nefes Ver",   color: "from-blue-400 to-indigo-400",  scale: 1.0 },
  'hold-out':  { label: "Bekle",       color: "from-blue-500 to-indigo-500",  scale: 1.0 }
};

export default function ZenBreathing() {
  const [activePattern, setActivePattern] = useState<BreathingPattern>(PATTERNS[0]);
  const [phase, setPhase] = useState<BreathPhase>('inhale');
  const [isPlaying, setIsPlaying] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0); // Geri sayım için

  // Ref'ler (Zamanlayıcıları temizlemek için)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- FAZ GEÇİŞ MANTIĞI ---
  const nextPhase = useCallback(() => {
    setPhase((prev) => {
      // Bir sonraki fazı belirle
      let next: BreathPhase = 'inhale';
      if (prev === 'inhale') next = 'hold-in';
      else if (prev === 'hold-in') next = 'exhale';
      else if (prev === 'exhale') next = 'hold-out';
      else next = 'inhale';

      // Eğer seçilen teknikte o fazın süresi 0 ise (örn: hold-out yoksa) atla
      if (activePattern.cycle[next] === 0) {
        if (next === 'inhale') return 'hold-in'; // (Teorik olarak inhale 0 olamaz ama güvenlik için)
        if (next === 'hold-in') return 'exhale';
        if (next === 'exhale') return 'hold-out';
        if (next === 'hold-out') return 'inhale';
      }
      return next;
    });
  }, [activePattern]);

  // --- TİTREŞİM (HAPTIC) ---
  const triggerHaptic = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
  }, []);

  // --- ANA DÖNGÜ ---
  useEffect(() => {
    if (!isPlaying) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const duration = activePattern.cycle[phase];
    
    // Eğer faz süresi 0 ise hemen sonrakine geç (Recursive koruması için setTimeout içinde)
    if (duration === 0) {
        nextPhase();
        return;
    }

    // Faz başladığında titreşim ver
    triggerHaptic();

    // Geri sayım sayacı
    let elapsed = 0;
    setTimeLeft(duration / 1000);
    
    intervalRef.current = setInterval(() => {
      elapsed += 100;
      setTimeLeft(Math.max(0, Math.ceil((duration - elapsed) / 1000)));
    }, 100);

    // Faz değişimi zamanlayıcısı
    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      nextPhase();
    }, duration);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [phase, activePattern, isPlaying, nextPhase, triggerHaptic]);

  // Mod değiştiğinde sıfırla
  const changePattern = (pattern: BreathingPattern) => {
    setActivePattern(pattern);
    setPhase('inhale');
    setIsPlaying(true);
    setShowSettings(false);
  };

  const config = PHASE_CONFIG[phase];

  return (
    <div className="w-full h-full min-h-[400px] flex flex-col items-center justify-center relative bg-slate-900/50 rounded-3xl border border-white/5 overflow-hidden shadow-2xl backdrop-blur-sm">
      
      {/* --- ARKA PLAN PARTİKÜLLERİ --- */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
         {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute bg-white/5 rounded-full"
              style={{
                width: Math.random() * 100 + 50,
                height: Math.random() * 100 + 50,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
              }}
              animate={{
                y: [0, -50, 0],
                opacity: [0.1, 0.3, 0.1],
                scale: [1, 1.2, 1],
              }}
              transition={{
                duration: Math.random() * 10 + 10,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
         ))}
      </div>

      {/* --- ÜST KONTROLLER --- */}
      <div className="absolute top-4 right-4 z-20">
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <Settings2 size={20} />
        </button>
      </div>

      {/* --- AYARLAR MENÜSÜ (OVERLAY) --- */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col p-6 overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-white font-bold text-lg">Nefes Modu Seçin</h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">Kapat</button>
            </div>
            
            <div className="space-y-3">
              {PATTERNS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => changePattern(p)}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border transition-all relative overflow-hidden group",
                    activePattern.id === p.id 
                      ? "bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)]" 
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                  )}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className={cn("font-bold", activePattern.id === p.id ? "text-indigo-400" : "text-white")}>
                      {p.name}
                    </span>
                    {activePattern.id === p.id && <CheckCircle2 size={18} className="text-indigo-400" />}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {p.description}
                  </p>
                  {/* Zamanlama Özeti */}
                  <div className="flex gap-2 mt-3 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                    <span>IN: {p.cycle.inhale/1000}s</span> • 
                    <span>HOLD: {p.cycle['hold-in']/1000}s</span> • 
                    <span>OUT: {p.cycle.exhale/1000}s</span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- ANA GÖRSEL --- */}
      <div className="relative z-10 flex flex-col items-center">
        
        {/* Nefes Küresi */}
        <div className="relative w-64 h-64 flex items-center justify-center">
          
          {/* Dış Halkalar (Eko) */}
          <AnimatePresence>
            {isPlaying && phase === 'inhale' && (
              <>
                <motion.div
                  initial={{ opacity: 0.5, scale: 1 }}
                  animate={{ opacity: 0, scale: 2 }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full border border-white/20"
                />
                <motion.div
                  initial={{ opacity: 0.5, scale: 1 }}
                  animate={{ opacity: 0, scale: 2 }}
                  transition={{ duration: 2, delay: 0.5, repeat: Infinity }}
                  className="absolute inset-0 rounded-full border border-white/10"
                />
              </>
            )}
          </AnimatePresence>

          {/* Ana Blob */}
          <motion.div
            animate={{
              scale: config.scale,
              rotate: phase === 'inhale' ? 10 : phase === 'exhale' ? -10 : 0,
            }}
            transition={{
              duration: activePattern.cycle[phase] / 1000,
              ease: "easeInOut"
            }}
            className={cn(
              "w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center relative shadow-[0_0_60px_rgba(255,255,255,0.15)] bg-gradient-to-br backdrop-blur-xl transition-colors duration-1000",
              config.color
            )}
          >
            {/* İç Doku */}
            <div className="absolute inset-0 rounded-full opacity-40 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay" />
            
            {/* İkon */}
            <Wind className="text-white w-10 h-10 drop-shadow-md z-10" />
            
            {/* Geri Sayım Sayacı (Küçük) */}
            <div className="absolute -bottom-8 font-mono text-xs font-bold text-white/50">
               {Math.ceil(timeLeft)}s
            </div>
          </motion.div>

          {/* Progress Ring (İsteğe Bağlı Görselleştirme) */}
          <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none opacity-20">
             <circle
               cx="50%" cy="50%" r="48%"
               fill="none" stroke="white" strokeWidth="1"
               strokeDasharray="10 10"
             />
          </svg>

        </div>

        {/* --- METİN VE DURUM --- */}
        <div className="mt-8 text-center h-16">
          <AnimatePresence mode='wait'>
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center gap-2"
            >
              <h2 className="text-3xl font-black text-white tracking-widest uppercase">
                {config.label}
              </h2>
              <p className="text-xs text-indigo-300 font-medium bg-indigo-950/50 px-3 py-1 rounded-full border border-indigo-500/30">
                {activePattern.name}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

      </div>

      {/* --- ALT KONTROL (PLAY/PAUSE) --- */}
      <div className="absolute bottom-6 z-20">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-4 bg-white text-slate-900 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
        >
          {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
        </button>
        <p className="text-[10px] text-white/30 text-center mt-2 font-medium uppercase tracking-wider">
          {isPlaying ? "Devam Ediyor" : "Duraklatıldı"}
        </p>
      </div>

    </div>
  );
}