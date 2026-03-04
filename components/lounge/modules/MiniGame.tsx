'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, RotateCcw, Skull, Gamepad2, Zap, Target, Volume2, VolumeX, Play } from 'lucide-react';
import { cn } from '@/utils/cn';

// Oyun dosyalarını çağırıyoruz
import JusticeRunner from './games/JusticeRunner';
import EvidenceHunter from './games/EvidenceHunter';
import LexPong from './games/LexPong';

// DÜZELTME: "export const" yerine "export default function" yapıldı
export default function MiniGame() {
  const [activeGame, setActiveGame] = useState<'NONE' | 'RUNNER' | 'SNAKE' | 'PONG'>('NONE');
  const [lastScore, setLastScore] = useState(0);
  const [showGameOver, setShowGameOver] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const handleGameOver = (score: number) => {
    setLastScore(score);
    setShowGameOver(true);
  };

  const resetToMenu = () => {
    setShowGameOver(false);
    setActiveGame('NONE');
  };

  // --- GAME OVER EKRANI ---
  if (showGameOver) {
    return (
      <div className="w-full h-[360px] bg-slate-950 rounded-3xl flex flex-col items-center justify-center relative overflow-hidden border border-red-900/30">
         <div className="absolute inset-0 opacity-10" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
         
         <motion.div 
           initial={{ scale: 0.8, opacity: 0 }} 
           animate={{ scale: 1, opacity: 1 }}
           className="z-10 text-center p-6 w-full"
         >
            <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)] animate-pulse">
               <Skull className="text-red-500 w-12 h-12" />
            </div>
            
            <h2 className="text-3xl font-black text-white mb-2 tracking-tight">DAVA DÜŞTÜ!</h2>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-white/5 mb-6 inline-block min-w-[200px]">
                <p className="text-slate-400 font-mono text-xs mb-1 uppercase tracking-widest">Toplam Skor</p>
                <span className="text-amber-400 text-3xl font-black drop-shadow-sm">{lastScore}</span>
            </div>
            
            <div className="flex gap-3 justify-center">
               <button onClick={() => setShowGameOver(false)} className="bg-white text-slate-900 px-6 py-3 rounded-xl font-bold hover:scale-105 transition-transform flex items-center gap-2 shadow-lg">
                  <RotateCcw size={18} /> Tekrar Dene
               </button>
               <button onClick={resetToMenu} className="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-700 transition-colors border border-slate-700">
                  Menüye Dön
               </button>
            </div>
         </motion.div>
      </div>
    );
  }

  if (activeGame === 'RUNNER') return <div className="w-full h-[360px] rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-slate-900"><JusticeRunner onGameOver={handleGameOver} onBack={resetToMenu} /></div>;
  if (activeGame === 'SNAKE') return <div className="w-full h-[360px] rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-slate-900"><EvidenceHunter onGameOver={handleGameOver} onBack={resetToMenu} /></div>;
  if (activeGame === 'PONG') return <div className="w-full h-[360px] rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-slate-900"><LexPong onGameOver={handleGameOver} onBack={resetToMenu} /></div>;

  return (
    <div className="w-full h-[360px] bg-slate-950 rounded-3xl p-6 border border-slate-800 flex flex-col relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-amber-600/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>

      <div className="flex items-center justify-between mb-8 z-10">
         <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/20">
               <Gamepad2 className="text-white w-6 h-6" />
            </div>
            <div>
               <h2 className="text-white font-black text-xl tracking-tight leading-none">Oyun Alanı</h2>
               <p className="text-slate-400 text-xs font-medium mt-1">Stres atmak için bir mod seçin</p>
            </div>
         </div>
         
         <button 
           onClick={() => setSoundEnabled(!soundEnabled)} 
           className="p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
           title="Ses Efektleri"
         >
           {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
         </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 z-10">
         <GameCard 
            title="Adalet Koşusu" desc="Engellerden zıpla" 
            icon={<Briefcase className="text-blue-400 w-6 h-6"/>} 
            color="group-hover:bg-blue-500/10 group-hover:border-blue-500/30" gradient="from-blue-500/20 to-transparent"
            onClick={() => setActiveGame('RUNNER')}
         />
         <GameCard 
            title="Delil Avcısı" desc="Klasik yılan oyunu" 
            icon={<Target className="text-emerald-400 w-6 h-6"/>} 
            color="group-hover:bg-emerald-500/10 group-hover:border-emerald-500/30" gradient="from-emerald-500/20 to-transparent"
            onClick={() => setActiveGame('SNAKE')}
         />
         <GameCard 
            title="Duruşma Tenisi" desc="Yapay zekaya karşı" 
            icon={<Zap className="text-amber-400 w-6 h-6"/>} 
            color="group-hover:bg-amber-500/10 group-hover:border-amber-500/30" gradient="from-amber-500/20 to-transparent"
            onClick={() => setActiveGame('PONG')}
         />
      </div>
    </div>
  );
}

const GameCard = ({ title, desc, icon, color, gradient, onClick }: any) => (
  <button 
    onClick={onClick}
    className={cn(
      "relative flex flex-col items-start justify-between p-5 rounded-2xl border border-white/5 bg-slate-900/50 transition-all duration-300 hover:scale-[1.03] hover:shadow-xl group overflow-hidden text-left h-full", color
    )}
  >
     <div className={cn("absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br", gradient)} />
     <div className="relative z-10 w-full">
        <div className="mb-4 p-3 bg-slate-950 rounded-xl shadow-inner inline-flex border border-white/5 group-hover:scale-110 transition-transform duration-300 origin-left">{icon}</div>
        <h3 className="text-slate-200 font-bold text-base mb-1 group-hover:text-white">{title}</h3>
        <p className="text-slate-500 text-xs leading-relaxed group-hover:text-slate-300">{desc}</p>
     </div>
     <div className="relative z-10 mt-4 self-end opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
        <div className="bg-white/10 p-1.5 rounded-full"><Play size={12} className="text-white" fill="currentColor" /></div>
     </div>
  </button>
);