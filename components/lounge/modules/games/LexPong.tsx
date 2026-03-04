'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, Play } from 'lucide-react';

const playSound = (type: string) => {};

export default function LexPong({ onGameOver, onBack }: { onGameOver: (score: number) => void, onBack: () => void }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [score, setScore] = useState(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const requestRef = useRef<number | null>(null);
  
    const state = useRef({
      ball: { x: 150, y: 100, dx: 2, dy: 2, size: 6, speed: 2.5 },
      paddlePlayer: { y: 75, height: 50, width: 8 },
      paddleAI: { y: 75, height: 50, width: 8, speed: 1.5, errorRate: 0.1 },
      height: 200, width: 300, shake: 0
    });

    const triggerShake = () => {
        state.current.shake = 10;
        if (containerRef.current) containerRef.current.style.transform = `translate(${Math.random()*4-2}px, ${Math.random()*4-2}px)`;
        setTimeout(() => { 
            state.current.shake = 0;
            if (containerRef.current) containerRef.current.style.transform = 'none';
        }, 100);
    };
  
    const update = useCallback(() => {
      const s = state.current;
      const cvs = canvasRef.current;
      if(!cvs) return;
      
      s.ball.x += s.ball.dx;
      s.ball.y += s.ball.dy;
  
      if (s.ball.y + s.ball.size > s.height || s.ball.y - s.ball.size < 0) {
        s.ball.dy *= -1;
        playSound('click');
      }
  
      const targetY = s.ball.y - s.paddleAI.height / 2;
      if (s.ball.dx > 0) {
          if (s.paddleAI.y < targetY) s.paddleAI.y += s.paddleAI.speed;
          if (s.paddleAI.y > targetY) s.paddleAI.y -= s.paddleAI.speed;
      }
      s.paddleAI.y = Math.max(0, Math.min(s.height - s.paddleAI.height, s.paddleAI.y));
  
      // Player Hit
      if (s.ball.x - s.ball.size < s.paddlePlayer.width && s.ball.y > s.paddlePlayer.y && s.ball.y < s.paddlePlayer.y + s.paddlePlayer.height) {
          s.ball.dx *= -1.05; 
          s.ball.x = s.paddlePlayer.width + s.ball.size; 
          setScore(sc => sc + 1);
          playSound('click');
          triggerShake();
      }
  
      // AI Hit
      if (s.ball.x + s.ball.size > s.width - s.paddleAI.width && s.ball.y > s.paddleAI.y && s.ball.y < s.paddleAI.y + s.paddleAI.height) {
          s.ball.dx *= -1.05;
          s.ball.x = s.width - s.paddleAI.width - s.ball.size;
          playSound('click');
      }
  
      if (s.ball.x < 0) {
        setIsPlaying(false);
        setTimeout(() => onGameOver(score), 0);
        return;
      }
      
      if (s.ball.x > s.width) {
         s.ball.x = s.width / 2; s.ball.y = s.height / 2; s.ball.dx = -2; s.ball.speed = 2.5;
         playSound('score');
         setScore(sc => sc + 5); 
      }
    }, [score, onGameOver]);
  
    const draw = useCallback(() => {
       const cvs = canvasRef.current;
       const ctx = cvs?.getContext('2d');
       if (!cvs || !ctx) return;
       const s = state.current;
       ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, s.width, s.height);
       ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(s.width/2, 0); ctx.lineTo(s.width/2, s.height); ctx.stroke(); ctx.setLineDash([]);
       ctx.shadowBlur = 10; ctx.shadowColor = '#fbbf24'; ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, s.ball.size, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
       ctx.fillStyle = '#3b82f6'; ctx.fillRect(0, s.paddlePlayer.y, s.paddlePlayer.width, s.paddlePlayer.height);
       ctx.fillStyle = '#ef4444'; ctx.fillRect(s.width - s.paddleAI.width, s.paddleAI.y, s.paddleAI.width, s.paddleAI.height);
    }, []);
  
    const loop = useCallback(() => {
       if(!isPlaying) return;
       update();
       draw();
       requestRef.current = requestAnimationFrame(loop);
    }, [isPlaying, update, draw]);
  
    useEffect(() => {
       if(isPlaying) requestRef.current = requestAnimationFrame(loop);
       return () => { if(requestRef.current) cancelAnimationFrame(requestRef.current); };
    }, [isPlaying, loop]);
  
    const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
       const cvs = canvasRef.current;
       if (!cvs) return;
       const rect = cvs.getBoundingClientRect();
       const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
       const scaleY = 200 / rect.height; 
       state.current.paddlePlayer.y = (clientY - rect.top) * scaleY - (state.current.paddlePlayer.height / 2);
    };
  
    return (
      <div ref={containerRef} className="w-full h-full relative flex flex-col items-center justify-center bg-slate-900 transition-none">
         <div className="absolute top-4 left-4 z-20"><button onClick={onBack} className="p-2 bg-white/10 rounded-full hover:bg-white/20"><ChevronLeft size={20} className="text-white"/></button></div>
         <div className="absolute top-8 font-mono text-3xl font-black text-white/90 mb-2 drop-shadow-md">{score}</div>
         <canvas ref={canvasRef} width={300} height={200} className="border-2 border-slate-700 rounded-lg cursor-none touch-none shadow-2xl bg-slate-800 w-[90%] max-w-[400px] aspect-[3/2]" onMouseMove={handleMove} onTouchMove={handleMove} />
         {!isPlaying && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
               <button onClick={() => setIsPlaying(true)} className="bg-blue-600 text-white px-8 py-3 rounded-full font-bold hover:bg-blue-500 shadow-lg flex items-center gap-2 animate-pulse">
                  <Play size={18} fill="currentColor" /> Maça Başla
               </button>
           </div>
         )}
      </div>
    );
}