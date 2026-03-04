'use client';

import { useState, useEffect } from 'react';
import { Star, ThumbsDown, Scale, Feather } from 'lucide-react';
import { createClient } from '@/utils/supabase/client'; 
import toast from 'react-hot-toast'; 
import { motion, AnimatePresence } from 'framer-motion';

// --- PEGASUS ICON (RESTORED TO ORIGINAL COLORS) ---
const PegasusIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M30 60 C30 60, 25 75, 20 85 L25 88 C35 80, 40 65, 40 60 Z" fill="currentColor" /> 
    <path d="M70 60 C70 60, 75 75, 80 85 L75 88 C65 80, 60 65, 60 60 Z" fill="currentColor" /> 
    <path d="M20 40 Q35 20 50 30 T80 40 L85 35 L75 25 L85 15 L70 20 Q60 10 50 20 Z" fill="currentColor" /> 
    {/* Restored: Gold Body */}
    <path d="M50 30 Q60 10 80 10 L75 20 Z" fill="#FFD700" />
    {/* Restored: Pink/Purple Gradient Wings */}
    <path d="M35 35 Q15 15 5 25 Q20 35 35 40 Z" fill="url(#pegasusWingGradient)" opacity="0.9" /> 
    <defs>
      <linearGradient id="pegasusWingGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#db2777" /> 
        <stop offset="100%" stopColor="#9333ea" /> 
      </linearGradient>
    </defs>
  </svg>
);

type ReactionType = 'woow' | 'doow' | 'adil';

interface ReactionBarProps {
  targetId: string;
  targetType: 'post' | 'comment'; 
  initialCounts: {
    woow: number;
    doow: number;
    adil: number;
    comment_count: number;
  };
  initialUserReaction: ReactionType | null;
  isOwner?: boolean;
  onMuzakereClick?: () => void;
  onTriggerPhysics?: () => void; 
}

export default function ReactionBar({
  targetId,
  targetType,
  initialCounts,
  initialUserReaction,
  isOwner = false,
  onMuzakereClick,
  onTriggerPhysics
}: ReactionBarProps) {
  
  const [counts, setCounts] = useState(initialCounts);
  const [myReaction, setMyReaction] = useState<ReactionType | null>(initialUserReaction);
  
  const [isKicking, setIsKicking] = useState(false);

  useEffect(() => {
    if (initialCounts) {
      setCounts(initialCounts);
    }
  }, [initialCounts]);

  useEffect(() => {
    setMyReaction(initialUserReaction);
  }, [initialUserReaction]);
  
  // --- UI RESILIENCE LOGIC (Fix remains active) ---
  const displayWoow = Math.max(counts.woow || 0, myReaction === 'woow' ? 1 : 0);
  const displayDoow = Math.max(counts.doow || 0, myReaction === 'doow' ? 1 : 0);
  const displayAdil = Math.max(counts.adil || 0, myReaction === 'adil' ? 1 : 0);

  const handleReaction = async (newReaction: ReactionType) => {
    if (isOwner) {
       toast.error("Kendi gönderinize oy veremezsiniz.");
       return;
    }

    if (newReaction === 'woow' && myReaction !== 'woow') {
        setIsKicking(true);
        if (onTriggerPhysics) onTriggerPhysics();
        setTimeout(() => setIsKicking(false), 600);
    }

    const prevReaction = myReaction;
    const prevCounts = { ...counts };
    
    let newCounts = { ...counts };
    
    const isTogglingOff = prevReaction === newReaction;
    const effectiveReaction = isTogglingOff ? null : newReaction;

    if (isTogglingOff) {
      setMyReaction(null);
      newCounts[newReaction] = Math.max(0, newCounts[newReaction] - 1);
    } else {
      if (prevReaction) {
        newCounts[prevReaction] = Math.max(0, newCounts[prevReaction] - 1);
      }
      newCounts[newReaction] += 1;
      setMyReaction(newReaction);
    }

    setCounts(newCounts);

    try {
      const supabase = createClient();
      
      const { error } = await supabase.rpc('handle_reaction', {
        p_target_id: targetId,
        p_target_type: targetType, 
        p_reaction_type: effectiveReaction 
      });

      if (error) throw error;
    } catch (error: any) {
      console.error('Reaksiyon Hatası Detaylı:', error);
      setMyReaction(prevReaction);
      setCounts(prevCounts);
      toast.error(error.message || 'Oylama sırasında bir hata oluştu.'); 
    }
  };

  if (!counts) return null;

  const inactiveBaseStyle = "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300 hover:text-slate-900 shadow-sm";

  return (
    <div className="flex items-center gap-4 mt-3 w-full select-none font-medium">
      
      {/* --- BUTTON 1: WOOW (RESTORED: Purple/Pink Gradient) --- */}
      <motion.button 
        onClick={() => handleReaction('woow')}
        className={`
            relative group flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300
            ${myReaction === 'woow' 
                ? 'bg-gradient-to-r from-purple-600 via-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/30 ring-1 ring-white/20' 
                : `${inactiveBaseStyle} hover:text-purple-600 hover:bg-purple-50`
            }
            ${isOwner ? 'opacity-50 cursor-not-allowed grayscale' : ''}
        `}
      >
        <div className="relative w-5 h-5 flex-shrink-0">
            <motion.div
                animate={isKicking ? {
                    rotate: [0, -15, 10, 0],
                    scale: [1, 1.3, 1],
                    y: [0, -3, 0]
                } : {}}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="w-full h-full"
            >
                {myReaction === 'woow' ? (
                    <PegasusIcon className="w-full h-full text-white drop-shadow-md" />
                ) : (
                    <Star className="w-full h-full transition-colors" />
                )}
            </motion.div>
        </div>

        <span className="relative z-10 font-bold">
            {displayWoow > 0 ? displayWoow : ''}
            {myReaction === 'woow' && (
              <span className="ml-1 text-xs opacity-90 font-normal hidden sm:inline">Woow</span>
            )}
        </span>

        <AnimatePresence>
            {isKicking && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    {[...Array(5)].map((_, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 1, scale: 0, x: 0, y: 0 }}
                            animate={{ 
                                opacity: 0, 
                                scale: 1.2, 
                                x: (Math.random() - 0.5) * 60, 
                                y: (Math.random() - 0.5) * 40 - 10
                            }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className="absolute w-1.5 h-1.5 rounded-full"
                            style={{ 
                                // Restored: Pink/Purple particles
                                backgroundColor: i % 2 === 0 ? '#e879f9' : '#c084fc',
                                left: '50%', 
                                top: '50%' 
                            }} 
                        />
                    ))}
                </div>
            )}
        </AnimatePresence>
      </motion.button>

      {/* --- BUTTON 2: DOOW (Preserved New Design) --- */}
      <motion.button 
        whileTap={ isOwner ? {} : { scale: 0.95 }}
        onClick={() => handleReaction('doow')}
        className={`
            flex items-center gap-2 px-3.5 py-2 rounded-full transition-all duration-200
            ${myReaction === 'doow' 
                ? 'bg-red-600 text-white shadow-md shadow-red-600/20 ring-1 ring-red-600' 
                : `${inactiveBaseStyle} hover:text-red-700 hover:ring-red-200 hover:bg-red-50`
            }
            ${isOwner ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <ThumbsDown className={`w-4.5 h-4.5 ${myReaction === 'doow' ? 'fill-white' : ''}`} />
        <span className="font-bold">{displayDoow > 0 ? displayDoow : ''}</span>
      </motion.button>

      {/* --- BUTTON 3: ADIL (Preserved New Design) --- */}
      <motion.button 
        whileTap={ isOwner ? {} : { scale: 0.95 }}
        onClick={() => handleReaction('adil')}
        className={`
            flex items-center gap-2 px-3.5 py-2 rounded-full transition-all duration-200
            ${myReaction === 'adil' 
                ? 'bg-slate-800 text-white shadow-md shadow-slate-800/30 ring-1 ring-slate-800' 
                : `${inactiveBaseStyle} hover:text-slate-900 hover:ring-slate-400`
            }
            ${isOwner ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Scale className={`w-4.5 h-4.5 ${myReaction === 'adil' ? 'fill-white' : ''}`} />
        <span className="font-bold">{displayAdil > 0 ? displayAdil : ''}</span>
      </motion.button>

      <div className="h-6 w-px bg-slate-300 mx-1"></div>

      {/* --- BUTTON 4: MÜZAKERE (Preserved New Design) --- */}
      <button 
        onClick={onMuzakereClick}
        className={`group flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 ${inactiveBaseStyle} hover:ring-slate-400`}
      >
        <Feather className="w-4.5 h-4.5 group-hover:rotate-12 transition-transform duration-200" />
        <span className="text-slate-800 font-extrabold">{(counts.comment_count || 0) > 0 ? counts.comment_count : ''}</span>
      </button>
    </div>
  );
}