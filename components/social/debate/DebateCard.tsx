'use client';

import { useState, useTransition, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Share2, Loader2, Check, ChevronDown, ChevronUp, TrendingUp, Users, Lock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import toast from 'react-hot-toast'; 

// Server Actions
import { voteDailyDebate, confirmVoteChange, getDebateComments, type Debate, type Comment } from "@/app/actions/debate";

import PersuasionModal from "./PersuasionModal";
import DebateCommentColumn from "./DebateCommentColumn"; 

interface DebateCardProps {
  debate: Debate;
  currentUserId?: string;
}

export default function DebateCard({ debate }: DebateCardProps) {
  const [isPending, startTransition] = useTransition();

  // --- LOCAL STATE ---
  const [stats, setStats] = useState(debate.stats);
  const [userVote, setUserVote] = useState(debate.userVote);
  const [showComments, setShowComments] = useState(false);
  
  // --- YENİ EKLENDİ: Fikir Değiştirme Sayacı ---
  const [changeCount, setChangeCount] = useState(debate.changeCount || 0);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalCandidates, setModalCandidates] = useState<any[]>([]);
  const [pendingChoice, setPendingChoice] = useState<'A' | 'B' | null>(null);

  // Buton genişliğini ölçmek için ref (Maskeleme tekniği için gerekli)
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [btnWidth, setBtnWidth] = useState(0);

  useEffect(() => {
    if (buttonRef.current) {
        setBtnWidth(buttonRef.current.offsetWidth);
    }
  }, []);

  // --- İSTATİSTİKLER ---
  const safeStats = stats || { a: 0, b: 0 };
  const total = (safeStats.a || 0) + (safeStats.b || 0);
  
  const percentA = total > 0 ? Math.round((safeStats.a / total) * 100) : 0;
  const percentB = total > 0 ? Math.round((safeStats.b / total) * 100) : 0;
  const hasVoted = !!userVote;

  // --- OY VERME ---
  const handleVote = (choice: 'A' | 'B') => {
    if (userVote === choice) return;

    // --- YENİ EKLENDİ: LİMİT KONTROLÜ (GÜVENLİK) ---
    // Eğer kullanıcı daha önce oy vermişse ve limiti doldurmuşsa engelle
    if (userVote && changeCount >= 3) {
        toast.error("Fikir değiştirme limitiniz (3/3) doldu. Artık taraf değiştiremezsiniz.", {
            icon: '🔒',
            style: {
                border: '1px solid #EF4444',
                padding: '16px',
                color: '#EF4444',
            },
        });
        return;
    }

    startTransition(async () => {
        const previousStats = { ...safeStats };
        const previousVote = userVote;

        // Optimistic Update
        setUserVote(choice);
        setStats(prev => {
             const current = prev || { a: 0, b: 0 };
             const isSwitching = previousVote !== null;
             const prevA = current.a || 0;
             const prevB = current.b || 0;
             return {
                 ...current,
                 a: choice === 'A' ? prevA + 1 : (previousVote === 'A' ? prevA - 1 : prevA),
                 b: choice === 'B' ? prevB + 1 : (previousVote === 'B' ? prevB - 1 : prevB),
                 total: (current.total || 0) + (isSwitching ? 0 : 1)
             };
        });

        const result = await voteDailyDebate(debate.id, choice);

        if (result.success) {
            toast.success("Oyunuz Kaydedildi");
            if (result.newStats) setStats({ ...result.newStats, total: result.newStats.a + result.newStats.b });
            
            // Eğer taraf değiştirdiyse sayacı artır
            if (previousVote) {
                setChangeCount(prev => prev + 1);
            } else {
                // İlk defa oy veriyorsa yorumları aç
                setShowComments(true);
            }
        } 
        else if (result.requiresPersuasion) {
             setModalCandidates(result.candidates || []);
             setPendingChoice(choice);
             setIsModalOpen(true);
             // Rollback
             setUserVote(previousVote);
             setStats(previousStats);
        } 
        else {
             toast.error(result.error || "İşlem başarısız");
             // Rollback
             setUserVote(previousVote);
             setStats(previousStats);
        }
    });
  };

  const handlePersuasionConfirm = (commentId: string) => {
      if (!pendingChoice) return;
      startTransition(async () => {
          const result = await confirmVoteChange(debate.id, pendingChoice, commentId);
          if (result.success) {
              setIsModalOpen(false);
              setUserVote(pendingChoice);
              setChangeCount(prev => prev + 1); // İkna olduysa da sayaç artmalı
              if (result.newStats) setStats({ ...result.newStats, total: result.newStats.a + result.newStats.b });
              toast.success("Fikir Değişikliği Onaylandı!");
          } else {
              toast.error(result.error || "Hata oluştu");
          }
      });
  };

  return (
    <>
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="overflow-hidden border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white group/card">
        
        {/* HEADER */}
        <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between space-y-0">
            <div className="flex gap-3">
               <Avatar className="h-10 w-10 border border-slate-100 shadow-sm">
                 <AvatarImage src={debate.created_by?.avatar_url} />
                 <AvatarFallback className="bg-slate-50 text-slate-500 font-bold">
                    {debate.created_by?.full_name?.substring(0,2).toUpperCase() || "??"}
                 </AvatarFallback>
               </Avatar>
               <div>
                  <p className="text-sm font-bold text-slate-900">{debate.created_by?.full_name || "Anonim"}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                      {debate.created_by?.job_title && <span className="font-medium text-slate-600">{debate.created_by.job_title}</span>}
                      <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                      {formatDistanceToNow(new Date(debate.created_at || new Date()), { addSuffix: true, locale: tr })}
                  </p>
               </div>
            </div>
            {debate.is_active && (
                <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] px-2.5 py-1 rounded-full font-bold shadow-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    CANLI
                </div>
            )}
        </CardHeader>

        <CardContent className="p-4 pt-2 space-y-4">
            <div>
                <h3 className="text-lg font-black text-slate-800 leading-tight mb-2">
                    {debate.title}
                </h3>
                <p className="text-sm text-slate-600 line-clamp-3 whitespace-pre-wrap">
                    {debate.description}
                </p>
            </div>

            {/* --- SOLID RENK MASKİNG OYLAMA BUTONLARI --- */}
            <div className="flex gap-3 w-full mt-3">
              
              {/* === YEŞİL TARAFI (KATILIYORUM) === */}
              <button
                ref={buttonRef}
                onClick={() => handleVote('A')}
                disabled={isPending}
                className={cn(
                  "relative flex-1 h-12 rounded-lg border-2 overflow-hidden transition-all duration-200 group isolate",
                  "bg-white border-emerald-200 hover:border-emerald-600",
                  !hasVoted && "hover:bg-emerald-600"
                )}
              >
                {/* 2. ARKA PLAN METNİ (Yeşil Yazı) */}
                <div className={cn(
                    "absolute inset-0 flex items-center justify-center gap-2 font-bold tracking-wide transition-colors z-0",
                    !hasVoted ? "text-emerald-600 group-hover:text-transparent" : "text-emerald-600"
                )}>
                    {isPending && userVote === 'A' ? <Loader2 className="w-4 h-4 animate-spin" /> : "KATILIYORUM"}
                    {hasVoted && <span className="opacity-80">%{percentA}</span>}
                </div>

                {/* 3. DOLULUK BARI (MASKELEME KATMANI) */}
                {hasVoted && (
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentA}%` }}
                        transition={{ duration: 0.8, ease: "circOut" }}
                        className="absolute top-0 left-0 h-full bg-emerald-600 overflow-hidden z-10"
                    >
                        {/* 4. ÖN PLAN METNİ (Beyaz Yazı) */}
                        <div 
                            className="absolute top-0 left-0 h-full flex items-center justify-center gap-2 font-bold tracking-wide text-white whitespace-nowrap"
                            style={{ width: btnWidth ? `${btnWidth}px` : '100%' }}
                        >
                            {isPending && userVote === 'A' ? <Loader2 className="w-4 h-4 animate-spin" /> : "KATILIYORUM"}
                            <span className="opacity-90">%{percentA}</span>
                        </div>
                    </motion.div>
                )}

                {/* Hover Text */}
                {!hasVoted && (
                    <div className="absolute inset-0 flex items-center justify-center font-bold tracking-wide text-white opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        KATILIYORUM
                    </div>
                )}
              </button>


              {/* === KIRMIZI TARAFI (KATILMIYORUM) === */}
              <button
                onClick={() => handleVote('B')}
                disabled={isPending}
                className={cn(
                  "relative flex-1 h-12 rounded-lg border-2 overflow-hidden transition-all duration-200 group isolate",
                  "bg-white border-rose-200 hover:border-rose-600",
                  !hasVoted && "hover:bg-rose-600"
                )}
              >
                {/* Arka Plan Metni (Kırmızı) */}
                <div className={cn(
                    "absolute inset-0 flex items-center justify-center gap-2 font-bold tracking-wide transition-colors z-0",
                    !hasVoted ? "text-rose-600 group-hover:text-transparent" : "text-rose-600"
                )}>
                    {isPending && userVote === 'B' ? <Loader2 className="w-4 h-4 animate-spin" /> : "KATILMIYORUM"}
                    {hasVoted && <span className="opacity-80">%{percentB}</span>}
                </div>

                {/* Doluluk Bari (Kırmızı Solid) */}
                {hasVoted && (
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentB}%` }}
                        transition={{ duration: 0.8, ease: "circOut" }}
                        className="absolute top-0 left-0 h-full bg-rose-600 overflow-hidden z-10"
                    >
                        {/* Ön Plan Metni (Beyaz) */}
                        <div 
                            className="absolute top-0 left-0 h-full flex items-center justify-center gap-2 font-bold tracking-wide text-white whitespace-nowrap"
                            style={{ width: btnWidth ? `${btnWidth}px` : '100%' }}
                        >
                            {isPending && userVote === 'B' ? <Loader2 className="w-4 h-4 animate-spin" /> : "KATILMIYORUM"}
                            <span className="opacity-90">%{percentB}</span>
                        </div>
                    </motion.div>
                )}

                {/* Hover Text */}
                {!hasVoted && (
                    <div className="absolute inset-0 flex items-center justify-center font-bold tracking-wide text-white opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        KATILMIYORUM
                    </div>
                )}
              </button>
            </div>
            
            {/* Alt Bilgi */}
            <div className="flex justify-between items-center -mt-1 px-1">
                 {/* Sayaç Bilgisi */}
                 {hasVoted && changeCount > 0 && changeCount < 3 && (
                     <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                        Kalan Hak: {3 - changeCount}
                     </span>
                 )}
                 {hasVoted && changeCount >= 3 && (
                     <span className="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Karar Kilitlendi
                     </span>
                 )}

                 <div className="ml-auto">
                     <p className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {total} kişi
                     </p>
                 </div>
            </div>

        </CardContent>

        {/* FOOTER */}
        <CardFooter className="p-0 flex flex-col items-stretch border-t border-slate-100 bg-slate-50/30">
             <div className="flex justify-between items-center px-4 py-3 w-full">
                 <div className="flex gap-2">
                     <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setShowComments(!showComments)}
                        className={cn(
                            "h-8 px-2.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-white gap-1.5 transition-colors rounded-md",
                            showComments && "bg-white text-indigo-600 shadow-sm"
                        )}
                     >
                        <MessageCircle className="w-4 h-4" />
                        <span>Tartışma</span>
                        {showComments ? <ChevronUp className="w-3 h-3 opacity-50" /> : <ChevronDown className="w-3 h-3 opacity-50" />}
                     </Button>

                     <Button 
                        variant="ghost" 
                        size="sm"
                        className="h-8 px-2.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-white gap-1.5 transition-colors rounded-md"
                     >
                        <Share2 className="w-4 h-4" />
                        <span>Paylaş</span>
                     </Button>
                 </div>
             </div>

             <AnimatePresence>
                 {showComments && (
                     <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-slate-100 bg-slate-50"
                     >
                         <DebateCommentColumn 
                            debateId={debate.id} 
                            userVote={userVote} 
                            isOpen={showComments} 
                         />
                     </motion.div>
                 )}
             </AnimatePresence>
        </CardFooter>
      </Card>
    </motion.div>

    <PersuasionModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        candidates={modalCandidates}
        onConfirm={handlePersuasionConfirm}
        isSubmitting={isPending}
        targetSide={pendingChoice || 'A'}
    />
    </>
  );
}