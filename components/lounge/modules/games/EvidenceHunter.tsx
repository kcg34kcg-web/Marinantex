'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, Play, Scroll, Star } from 'lucide-react';
import { cn } from '@/utils/cn';

const CELL_COUNT = 20;

const playSound = (type: string) => {};

export default function EvidenceHunter({ onGameOver, onBack }: { onGameOver: (score: number) => void, onBack: () => void }) {
  const [snake, setSnake] = useState<{x:number, y:number}[]>([{x: 10, y: 10}]);
  const [food, setFood] = useState({x: 15, y: 5});
  const [bonus, setBonus] = useState<{x:number, y:number} | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  
  const directionRef = useRef<'UP'|'DOWN'|'LEFT'|'RIGHT'>('RIGHT');
  const gameLoopRef = useRef<NodeJS.Timeout | null>(null);
  const bonusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const spawnFood = () => ({ x: Math.floor(Math.random() * CELL_COUNT), y: Math.floor(Math.random() * CELL_COUNT) });

  const spawnBonus = useCallback(() => {
      if (Math.random() > 0.7) { 
         setBonus(spawnFood());
         bonusTimeoutRef.current = setTimeout(() => setBonus(null), 5000);
      }
  }, []);

  const moveSnake = useCallback(() => {
    if (!isPlaying) return;

    setSnake(prevSnake => {
      const head = { ...prevSnake[0] };
      switch (directionRef.current) {
        case 'UP': head.y -= 1; break;
        case 'DOWN': head.y += 1; break;
        case 'LEFT': head.x -= 1; break;
        case 'RIGHT': head.x += 1; break;
      }

      if (head.x < 0 || head.x >= CELL_COUNT || head.y < 0 || head.y >= CELL_COUNT || prevSnake.some(s => s.x === head.x && s.y === head.y)) {
        setIsPlaying(false);
        playSound('crash');
        setTimeout(() => onGameOver(score), 0);
        return prevSnake;
      }

      const newSnake = [head, ...prevSnake];

      if (head.x === food.x && head.y === food.y) {
        setScore(s => {
             const newScore = s + 1;
             if (newScore % 5 === 0) spawnBonus(); 
             return newScore;
        });
        playSound('score');
        setFood(spawnFood());
      } else if (bonus && head.x === bonus.x && head.y === bonus.y) {
        setScore(s => s + 5); 
        playSound('score');
        setBonus(null);
        if (bonusTimeoutRef.current) clearTimeout(bonusTimeoutRef.current);
      } else {
        newSnake.pop(); 
      }
      return newSnake;
    });
  }, [food, bonus, isPlaying, score, onGameOver, spawnBonus]);

  useEffect(() => {
    if (isPlaying) {
      const baseSpeed = 180; 
      const speed = Math.max(80, baseSpeed - (score * 3)); 
      gameLoopRef.current = setInterval(moveSnake, speed);
    }
    return () => {
        if (gameLoopRef.current) clearInterval(gameLoopRef.current);
        if (bonusTimeoutRef.current) clearTimeout(bonusTimeoutRef.current);
    };
  }, [isPlaying, moveSnake, score]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const c = directionRef.current;
      if (e.key === 'ArrowUp' && c !== 'DOWN') directionRef.current = 'UP';
      if (e.key === 'ArrowDown' && c !== 'UP') directionRef.current = 'DOWN';
      if (e.key === 'ArrowLeft' && c !== 'RIGHT') directionRef.current = 'LEFT';
      if (e.key === 'ArrowRight' && c !== 'LEFT') directionRef.current = 'RIGHT';
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="w-full h-full relative bg-slate-900 flex flex-col items-center justify-center overflow-hidden">
       <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #3b82f6 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
       <div className="absolute top-4 left-4 z-20"><button onClick={onBack} className="p-2 bg-white/10 rounded-full hover:bg-white/20"><ChevronLeft size={20} className="text-white"/></button></div>
       <div className="absolute top-4 right-4 z-20 font-mono text-2xl font-bold text-emerald-400">Delil: {score}</div>
       
       {!isPlaying && score === 0 && (
         <div className="absolute z-30 inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <button onClick={() => setIsPlaying(true)} className="bg-emerald-600 px-8 py-3 rounded-full text-white font-bold hover:bg-emerald-500 shadow-lg animate-bounce flex items-center gap-2">
               <Play size={18} fill="currentColor" /> Avı Başlat
            </button>
         </div>
       )}

       <div className="w-[300px] h-[300px] bg-slate-800/80 border-2 border-slate-700 grid relative rounded-xl overflow-hidden shadow-2xl" style={{ gridTemplateColumns: `repeat(${CELL_COUNT}, 1fr)`, gridTemplateRows: `repeat(${CELL_COUNT}, 1fr)` }}>
          {bonus && <div className="absolute flex items-center justify-center animate-spin" style={{ width: '5%', height: '5%', left: `${(bonus.x/CELL_COUNT)*100}%`, top: `${(bonus.y/CELL_COUNT)*100}%`, transition: 'all 0.2s'}}><Star size={14} className="text-amber-400 fill-amber-400" /></div>}
          <div className="absolute bg-emerald-500/20 rounded-full animate-pulse flex items-center justify-center" style={{ width: '5%', height: '5%', left: `${(food.x/CELL_COUNT)*100}%`, top: `${(food.y/CELL_COUNT)*100}%` }}><Scroll size={12} className="text-emerald-400" /></div>
          {snake.map((s, i) => (<div key={`${s.x}-${s.y}-${i}`} className={cn("absolute rounded-sm transition-all duration-75 border-[0.5px] border-black/20", i===0?"bg-blue-400 z-10":"bg-blue-600 opacity-90")} style={{ width: '5%', height: '5%', left: `${(s.x/CELL_COUNT)*100}%`, top: `${(s.y/CELL_COUNT)*100}%` }}></div>))}
       </div>
       
       <div className="mt-4 grid grid-cols-3 gap-2 md:hidden scale-90 opacity-80">
          <div></div><button className="bg-white/10 p-4 rounded-xl" onClick={()=>directionRef.current='UP'}>⬆️</button><div></div>
          <button className="bg-white/10 p-4 rounded-xl" onClick={()=>directionRef.current='LEFT'}>⬅️</button>
          <button className="bg-white/10 p-4 rounded-xl" onClick={()=>directionRef.current='DOWN'}>⬇️</button>
          <button className="bg-white/10 p-4 rounded-xl" onClick={()=>directionRef.current='RIGHT'}>➡️</button>
       </div>
    </div>
  );
}