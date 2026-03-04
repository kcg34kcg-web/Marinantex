'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BrainCircuit, CheckCircle2 } from "lucide-react"; 
import { useState } from "react";
import { cn } from "@/utils/cn";

// --- YENİ: Listede kullanmak için Statik Mini Alkış İkonu ---
const SmallClapIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <defs>
      <linearGradient id="smallClapGradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F59E0B" /> {/* Amber */}
        <stop offset="1" stopColor="#EA580C" /> {/* Orange */}
      </linearGradient>
    </defs>
    <path 
      d="M6.5 10C6.5 8.61929 7.61929 7.5 9 7.5H10.5V16.5H4.5C3.39543 16.5 2.5 15.6046 2.5 14.5V14C2.5 12.8954 3.39543 12 4.5 12H5V11.5C5 10.6716 5.67157 10 6.5 10Z" 
      fill="url(#smallClapGradient)" 
    />
    <path 
      d="M17.5 10C17.5 8.61929 16.3807 7.5 15 7.5H13.5V16.5H19.5C20.6046 16.5 21.5 15.6046 21.5 14.5V14C21.5 12.8954 20.6046 12 19.5 12H19V11.5C19 10.6716 18.3284 10 17.5 10Z" 
      fill="url(#smallClapGradient)"
      fillOpacity="0.8" 
    />
  </svg>
);

interface Candidate {
  id: string;
  content: string;
  persuasion_count: number;
  profiles: {
    full_name: string;
    avatar_url: string;
    job_title: string;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  candidates: Candidate[];
  onConfirm: (commentId: string) => void;
  isSubmitting: boolean;
  targetSide: 'A' | 'B';
}

export default function PersuasionModal({ 
  isOpen, 
  onClose, 
  candidates, 
  onConfirm, 
  isSubmitting,
  targetSide 
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleConfirm = () => {
    if (selectedId) {
      onConfirm(selectedId);
    }
  };

  const isA = targetSide === 'A';
  const accentColor = isA ? "text-emerald-600" : "text-rose-600";
  const borderRingColor = isA ? "ring-emerald-600/20 border-emerald-600" : "ring-rose-600/20 border-rose-600";
  const buttonColor = isA ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSubmitting && !open && onClose()}>
      <DialogContent className="sm:max-w-md bg-slate-50 border-slate-200 p-0 overflow-hidden">
        
        {/* HEADER */}
        <DialogHeader className="p-6 pb-4 bg-white border-b border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <div className={cn("p-2.5 rounded-full bg-slate-100", accentColor)}>
                <BrainCircuit className="w-6 h-6" />
            </div>
            <div>
                <DialogTitle className="text-lg font-black text-slate-800">
                    Fikir Değişikliği Onayı
                </DialogTitle>
                <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-slate-500 font-medium">Yeni Tercihin:</span>
                    <span className={cn("text-xs font-bold px-2 py-0.5 rounded border bg-white uppercase", 
                        isA ? "text-emerald-700 border-emerald-200 bg-emerald-50" : "text-rose-700 border-rose-200 bg-rose-50"
                    )}>
                        {isA ? "KATILIYORUM (A)" : "KATILMIYORUM (B)"}
                    </span>
                </div>
            </div>
          </div>
          <DialogDescription className="text-slate-500 text-sm mt-2">
            Kararını değiştirmek üzeresin. Bu konuda seni ikna eden veya en çok etkileyen yorumu seçerek sahibine puan kazandırabilirsin.
          </DialogDescription>
        </DialogHeader>

        {/* LİSTE */}
        <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto bg-slate-50/50">
           {candidates.map((item) => (
             <div 
               key={item.id}
               onClick={() => setSelectedId(item.id)}
               className={cn(
                 "relative p-4 rounded-xl border-2 transition-all cursor-pointer group bg-white",
                 selectedId === item.id 
                    ? cn("shadow-md ring-2", borderRingColor)
                    : "border-transparent hover:border-slate-300 shadow-sm"
               )}
             >
                <div className={cn(
                    "absolute top-3 right-3 transition-all duration-300 transform",
                    selectedId === item.id ? "opacity-100 scale-100" : "opacity-0 scale-50"
                )}>
                    <CheckCircle2 className={cn("w-5 h-5 fill-white", accentColor)} />
                </div>

                <div className="flex gap-3">
                   <Avatar className="w-10 h-10 border border-slate-100 shadow-sm">
                     <AvatarImage src={item.profiles?.avatar_url} />
                     <AvatarFallback className="text-xs bg-slate-200 text-slate-500">
                        {item.profiles?.full_name?.substring(0,2).toUpperCase()}
                     </AvatarFallback>
                   </Avatar>
                   
                   <div className="flex-1 pr-6">
                      <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-xs text-slate-800">{item.profiles?.full_name}</span>
                          
                          {/* --- GÜNCELLENEN ALKIŞ ROZETİ --- */}
                          {item.persuasion_count > 0 && (
                              <span className="flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded-full bg-orange-50 border border-orange-100/50">
                                {/* Özel Mini SVG İkon */}
                                <SmallClapIcon className="w-3 h-3" />
                                
                                {/* Gradient Renkli Sayı */}
                                <span className="text-[10px] font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-600 to-orange-600 tabular-nums">
                                    {item.persuasion_count}
                                </span>
                              </span>
                          )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                          "{item.content}"
                      </p>
                   </div>
                </div>
             </div>
           ))}
        </div>

        {/* FOOTER */}
        <div className="p-4 bg-white border-t border-slate-100 flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={isSubmitting} className="text-slate-500">
                Vazgeç
            </Button>
            <Button 
                onClick={handleConfirm} 
                disabled={!selectedId || isSubmitting}
                className={cn(
                    "font-bold transition-all text-white shadow-sm",
                    selectedId ? buttonColor : "bg-slate-200 text-slate-400 cursor-not-allowed"
                )}
            >
                {isSubmitting ? "Kaydediliyor..." : "Bu Yorum Beni İkna Etti"}
            </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}