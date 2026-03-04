'use client';

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { markAsPersuasive } from "@/app/actions/debate";
import { cn } from "@/utils/cn";

// --- ÖZEL "LIVING" ICON BİLEŞENİ ---
const LivingClapIcon = ({ isClicked, isAnimating }: { isClicked: boolean, isAnimating: boolean }) => {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="overflow-visible">
      <defs>
        {/* Modern Gradient Dolgu */}
        <linearGradient id="clapGradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F59E0B" /> {/* Amber */}
          <stop offset="1" stopColor="#EA580C" /> {/* Orange Red */}
        </linearGradient>
      </defs>

      {/* SOL EL (Animasyonla hareket eder) */}
      <g className={cn("transition-all duration-300 origin-bottom-right", isAnimating ? "animate-clap-left" : "")}>
        <path 
          d="M6.5 10C6.5 8.61929 7.61929 7.5 9 7.5H10.5V16.5H4.5C3.39543 16.5 2.5 15.6046 2.5 14.5V14C2.5 12.8954 3.39543 12 4.5 12H5V11.5C5 10.6716 5.67157 10 6.5 10Z" 
          fill={isClicked ? "url(#clapGradient)" : "#94A3B8"} // Tıklanmamışsa gri, tıklanmışsa gradient
          className="transition-colors duration-300"
        />
        <rect x="6" y="15" width="4" height="6" rx="1" fill={isClicked ? "url(#clapGradient)" : "#94A3B8"} className="transition-colors duration-300" />
      </g>

      {/* SAĞ EL (Animasyonla hareket eder) */}
      <g className={cn("transition-all duration-300 origin-bottom-left", isAnimating ? "animate-clap-right" : "")}>
        <path 
          d="M17.5 10C17.5 8.61929 16.3807 7.5 15 7.5H13.5V16.5H19.5C20.6046 16.5 21.5 15.6046 21.5 14.5V14C21.5 12.8954 20.6046 12 19.5 12H19V11.5C19 10.6716 18.3284 10 17.5 10Z" 
          fill={isClicked ? "url(#clapGradient)" : "#CBD5E1"} // Sağ el biraz daha açık ton (derinlik için)
          className="transition-colors duration-300"
        />
        <rect x="14" y="15" width="4" height="6" rx="1" fill={isClicked ? "url(#clapGradient)" : "#CBD5E1"} className="transition-colors duration-300" />
      </g>

      {/* KIVILCIMLAR (Sadece animasyon sırasında görünür) */}
      {isAnimating && (
        <g className="animate-sparks origin-center">
            <path d="M12 4V2" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
            <path d="M18 6L19.5 4.5" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
            <path d="M6 6L4.5 4.5" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
        </g>
      )}
    </svg>
  );
};

// --- ANA COMPONENT ---

interface Props {
  debateId: string;
  commentId: string;
  authorId: string;
  initialCount: number;
  userSide: 'A' | 'B' | null;
  commentSide: 'A' | 'B';
}

export default function PersuasionButton({ 
  debateId, 
  commentId, 
  authorId, 
  initialCount,
  userSide,
  commentSide 
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [count, setCount] = useState(initialCount);
  const [hasClicked, setHasClicked] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClap = () => {
    if (hasClicked) return;

    if (userSide === commentSide) {
        toast.error("Kendi tarafını alkışlayamazsın!", { icon: '🚫' });
        return;
    }
    if (!userSide) {
        toast.error("Tarafını seçmelisin.", { icon: '⚖️' });
        return;
    }

    // Animasyonu başlat
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 600); // 600ms sonra durdur

    startTransition(async () => {
        setCount(prev => prev + 1);
        setHasClicked(true);

        const result = await markAsPersuasive(debateId, commentId, authorId);

        if (!result.success) {
            setCount(prev => prev - 1);
            setHasClicked(false);
            toast.error("Kendi yorumunuzuna ikna olamazsınız ");
        } else {
             // Custom Toast
             toast.custom((t) => (
                <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}>
                  <div className="flex-1 w-0 p-4">
                    <div className="flex items-start">
                      <div className="flex-shrink-0 pt-0.5">
                        <span className="text-xl">👏</span>
                      </div>
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-medium text-gray-900">Alkışladın!</p>
                        <p className="mt-1 text-sm text-gray-500">Bu yorumu destekledin.</p>
                      </div>
                    </div>
                  </div>
                </div>
              ));
        }
    });
  };

  return (
    <>
      <style jsx global>{`
        /* SOL EL HAREKETİ */
        @keyframes clap-left {
            0% { transform: rotate(0deg) translateX(0); }
            50% { transform: rotate(15deg) translateX(2px); }
            100% { transform: rotate(0deg) translateX(0); }
        }
        .animate-clap-left { animation: clap-left 0.2s ease-in-out 2 alternate; }

        /* SAĞ EL HAREKETİ */
        @keyframes clap-right {
            0% { transform: rotate(0deg) translateX(0); }
            50% { transform: rotate(-15deg) translateX(-2px); }
            100% { transform: rotate(0deg) translateX(0); }
        }
        .animate-clap-right { animation: clap-right 0.2s ease-in-out 2 alternate; }

        /* KIVILCIM EFEKTİ */
        @keyframes sparks {
            0% { opacity: 0; transform: scale(0.5); }
            50% { opacity: 1; transform: scale(1.2); }
            100% { opacity: 0; transform: scale(1.5); }
        }
        .animate-sparks { animation: sparks 0.4s ease-out forwards; }
      `}</style>

      <button
        onClick={handleClap}
        disabled={isPending || hasClicked || !userSide}
        className={cn(
            "group relative flex items-center gap-2.5 px-3 py-1.5 rounded-full transition-all duration-300 border select-none",
            "bg-white hover:bg-slate-50", // Base Style
            
            // BORDER RENGİ
            hasClicked 
                ? "border-orange-200 shadow-[0_0_10px_rgba(249,115,22,0.15)]" // Tıklanınca hafif turuncu glow
                : "border-slate-200 hover:border-orange-200 shadow-sm hover:shadow-md",

            // CURSOR
            (isPending || !userSide) && "opacity-70 cursor-not-allowed"
        )}
      >
        {isPending ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        ) : (
            // ÖZEL LIVING ICON
            <LivingClapIcon isClicked={hasClicked} isAnimating={isAnimating} />
        )}

        {/* SAYAÇ */}
        <div className="flex flex-col items-start leading-none">
            <span className={cn(
                "text-sm font-bold tabular-nums transition-colors",
                hasClicked ? "text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-600" : "text-slate-600 group-hover:text-slate-800"
            )}>
                {count}
            </span>
            {/* Küçük Etiket */}
            <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wide">
                Alkış
            </span>
        </div>

        {/* Tıklandı Onayı (Checkmark) */}
        {hasClicked && !isAnimating && (
             <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow-sm animate-in zoom-in duration-300"></div>
        )}
      </button>
    </>
  );
}