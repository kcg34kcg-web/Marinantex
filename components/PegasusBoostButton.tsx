'use client';

import { useState, useCallback } from 'react';
import { motion, useAnimate, AnimationSequence } from 'framer-motion';
import { cn } from '@/utils/cn'; // Assuming you have a class merger, if not remove cn

// --- 1. THE PEGASUS ICON (SVG) ---
const PegasusIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 100 100" 
    fill="currentColor" 
    className={className} 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Stylized Winged Horse with Horn */}
    <path d="M30 60 C30 60, 25 75, 20 85 L25 88 C35 80, 40 65, 40 60 Z" fill="currentColor" /> {/* Back Leg */}
    <path d="M70 60 C70 60, 75 75, 80 85 L75 88 C65 80, 60 65, 60 60 Z" fill="currentColor" /> {/* Front Leg */}
    <path d="M20 40 Q35 20 50 30 T80 40 L85 35 L75 25 L85 15 L70 20 Q60 10 50 20 Z" fill="currentColor" /> {/* Body & Head */}
    <path d="M50 30 Q60 10 80 10 L75 20 Z" fill="#FFD700" /> {/* Gold Horn */}
    <path d="M35 35 Q15 15 5 25 Q20 35 35 40 Z" fill="url(#wingGradient)" opacity="0.9" /> {/* Wing */}
    <defs>
      <linearGradient id="wingGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#db2777" /> {/* Hot Pink */}
        <stop offset="100%" stopColor="#9333ea" /> {/* Purple */}
      </linearGradient>
    </defs>
  </svg>
);

// --- 2. PARTICLE SYSTEM ---
const Particle = ({ x, y, color }: { x: number; y: number; color: string }) => (
  <motion.div
    initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
    animate={{ x, y, opacity: 0, scale: 0 }}
    transition={{ duration: 0.6, ease: "easeOut" }}
    className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full pointer-events-none"
    style={{ backgroundColor: color }}
  />
);

interface PegasusBoostProps {
  isActive: boolean;
  count: number;
  onClick: () => void;
  onBoostPhysics: () => void; // Triggers the parent jolt
}

export default function PegasusBoostButton({ 
  isActive, 
  count, 
  onClick, 
  onBoostPhysics 
}: PegasusBoostProps) {
  const [scope, animate] = useAnimate();
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string }[]>([]);

  const triggerAnimation = useCallback(async () => {
    // 1. Generate Particles
    const newParticles = Array.from({ length: 8 }).map((_, i) => {
      const angle = (i * 45) * (Math.PI / 180);
      const dist = 20 + Math.random() * 20;
      const colors = ['#9333ea', '#db2777', '#dc2626']; // Purple, Pink, Red
      return {
        id: Date.now() + i,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        color: colors[Math.floor(Math.random() * colors.length)]
      };
    });
    setParticles(newParticles);

    // 2. The Pegasus Sequence
    const sequence: AnimationSequence = [
      // Rear Up (Backwards tilt)
      [scope.current, { rotate: -25, scale: 1.2, y: -5 }, { duration: 0.2, ease: "easeOut" }],
      // Kick (Lunges forward)
      [scope.current, { rotate: 15, scale: 1.3, x: 5 }, { duration: 0.1, ease: "easeIn" }],
      // Return to Normal
      [scope.current, { rotate: 0, scale: 1, x: 0, y: 0 }, { duration: 0.3, type: "spring", bounce: 0.5 }]
    ];

    // Execute Animation
    await animate(sequence);
    
    // Clear particles after animation
    setTimeout(() => setParticles([]), 700);

  }, [animate, scope]);

  const handleClick = () => {
    // 1. Trigger Visual Animation
    triggerAnimation();
    
    // 2. Trigger Parent Physics (The Jolt) at the impact moment
    setTimeout(() => {
        onBoostPhysics();
    }, 200); // Sync with the "Kick" frame above

    // 3. Execute Core Logic
    onClick();
  };

  return (
    <button 
      onClick={handleClick}
      className={cn(
        "group flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all border",
        isActive 
          ? "bg-purple-900/20 border-purple-500/50 text-purple-400" 
          : "border-transparent text-slate-400 hover:bg-slate-100 hover:text-purple-500"
      )}
    >
      <div className="relative w-6 h-6">
        {/* Animated Icon Wrapper */}
        <motion.div ref={scope} className="w-full h-full origin-bottom-left">
          <PegasusIcon className={cn("w-full h-full", isActive && "text-purple-500 fill-current")} />
        </motion.div>

        {/* Particle Overlay */}
        {particles.map((p) => (
          <Particle key={p.id} x={p.x} y={p.y} color={p.color} />
        ))}
      </div>

      <span className={cn("text-xs font-bold font-sans", isActive && "text-purple-400")}>
        {count} <span className="hidden sm:inline ml-1">WOOW</span>
      </span>
    </button>
  );
}