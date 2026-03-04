'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, Gavel, Trophy, Play, ChevronLeft, Scale } from 'lucide-react';

const playSound = (type: 'jump' | 'score' | 'crash' | 'click') => {
    // Ses efektleri buraya eklenebilir
};

export default function JusticeRunner({ onGameOver, onBack }: { onGameOver: (score: number) => void, onBack: () => void }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  
  const scoreRef = useRef(0);
  const playerRef = useRef<HTMLDivElement>(null);
  const obstacleRef = useRef<HTMLDivElement>(null);
  const cloudRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);
  
  // FİZİK AYARLARI (Optimize)
  const physics = useRef({
    isJumping: false,
    velocity: 0,
    position: 0,
    obstaclePos: -20,
    cloudPos: 100,
    speed: 0.8,
    gravity: 0.5,
    jumpStrength: 13
  });

  useEffect(() => {
    scoreRef.current = score;
    const saved = localStorage.getItem('runner_highscore');
    if (saved) setHighScore(parseInt(saved));
  }, [score]);

  const jump = useCallback(() => {
    if (!isPlaying) {
      setIsPlaying(true);
      return;
    }
    if (!physics.current.isJumping) {
      playSound('jump');
      physics.current.isJumping = true;
      physics.current.velocity = physics.current.jumpStrength;
    }
  }, [isPlaying]);

  const loop = useCallback(() => {
    if (!isPlaying) return;

    const p = physics.current;

    // 1. Oyuncu Fiziği
    if (p.isJumping) {
      p.position += p.velocity;
      p.velocity -= p.gravity;
      if (p.position <= 0) {
        p.position = 0;
        p.isJumping = false;
        p.velocity = 0;
      }
    }

    // 2. Engel Hareketi
    p.obstaclePos -= p.speed + (scoreRef.current * 0.0002); 
    if (p.obstaclePos < -20) { 
      p.obstaclePos = 100 + Math.random() * 30;
      setScore(s => s + 10);
      playSound('score');
    }

    // 3. Bulut Hareketi
    p.cloudPos -= 0.1;
    if (p.cloudPos < -30) p.cloudPos = 110;

    // 4. Render
    if (playerRef.current) {
      playerRef.current.style.bottom = `${p.position}px`;
      playerRef.current.style.transform = `rotate(${p.isJumping ? -15 : 0}deg) scale(${p.isJumping ? 1.1 : 1})`;
    }
    if (obstacleRef.current) {
      obstacleRef.current.style.left = `${p.obstaclePos}%`;
    }
    if (cloudRef.current) {
      cloudRef.current.style.left = `${p.cloudPos}%`;
    }

    // 5. Çarpışma
    const playerRect = playerRef.current?.getBoundingClientRect();
    const obstacleRect = obstacleRef.current?.getBoundingClientRect();

    if (playerRect && obstacleRect) {
      const buffer = 15;
      const hitX = playerRect.right - buffer > obstacleRect.left + buffer && playerRect.left + buffer < obstacleRect.right - buffer;
      const hitY = playerRect.bottom - buffer > obstacleRect.top + buffer;

      if (hitX && hitY) {
        playSound('crash');
        setIsPlaying(false);
        if (scoreRef.current > highScore) {
            localStorage.setItem('runner_highscore', scoreRef.current.toString());
        }
        setTimeout(() => onGameOver(scoreRef.current), 0);
        return; 
      }
    }

    requestRef.current = requestAnimationFrame(loop);
  }, [isPlaying, highScore, onGameOver]);

  useEffect(() => {
    if (isPlaying) {
      physics.current = { 
        isJumping: false, velocity: 0, position: 0, 
        obstaclePos: 100, cloudPos: 100, speed: 0.8, 
        gravity: 0.5, jumpStrength: 13 
      };
      setScore(0);
      requestRef.current = requestAnimationFrame(loop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, loop]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [jump]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-slate-900 cursor-pointer group select-none" onClick={jump}>
      {/* HUD */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
         <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="p-2 bg-white/10 rounded-full hover:bg-white/20 backdrop-blur-md transition-colors">
            <ChevronLeft size={20} className="text-white"/>
         </button>
         <div className="px-3 py-1 bg-black/40 rounded-full border border-white/10 text-xs text-amber-500 font-mono flex items-center gap-1">
            <Trophy size={12} /> High: {highScore}
         </div>
      </div>
      <div className="absolute top-4 right-4 z-20 font-mono text-4xl font-black text-amber-500 drop-shadow-[0_2px_10px_rgba(245,158,11,0.5)]">
         {score}
      </div>
      
      {!isPlaying && score === 0 && (
         <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/60 backdrop-blur-[2px] animate-in fade-in">
            <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                <Play size={48} className="text-amber-500 opacity-90 mb-2" fill="currentColor" />
            </motion.div>
            <p className="text-white font-bold text-lg tracking-wide">Koşmak için Tıkla</p>
         </div>
      )}

      {/* Oyun Alanı */}
      <div ref={cloudRef} className="absolute top-10 w-24 h-12 opacity-20 bg-white blur-xl rounded-full"></div>
      <div className="absolute bottom-0 w-full h-[4px] bg-gradient-to-r from-slate-700 via-slate-500 to-slate-700 shadow-[0_-5px_20px_rgba(255,255,255,0.1)]"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03]"><Scale size={200} className="text-white"/></div>

      <div ref={playerRef} className="absolute left-8 bottom-0 w-12 h-12 z-10 will-change-transform">
        <div className="w-full h-full bg-blue-600 rounded-xl flex items-center justify-center border-2 border-blue-400 shadow-[0_0_25px_rgba(37,99,235,0.6)] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-6 h-6 bg-white/20 rounded-bl-full"></div>
            <Briefcase className="text-white w-6 h-6 relative z-10" />
        </div>
        {physics.current.isJumping && <div className="absolute -bottom-4 left-1/2 w-8 h-2 bg-blue-500/50 blur-md rounded-full animate-ping" />}
      </div>

      <div ref={obstacleRef} className="absolute left-full bottom-0 w-10 h-16 flex flex-col items-center justify-end z-10 will-change-transform">
         <div className="w-9 h-9 bg-red-600 rounded-lg flex items-center justify-center border-2 border-red-400 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
             <Gavel className="text-white w-5 h-5" />
         </div>
         <div className="w-1.5 h-8 bg-gradient-to-b from-red-800 to-red-950 rounded-b-md"></div>
      </div>
    </div>
  );
}