'use client';

import { voteDailyDebate, confirmVoteChange, type Debate } from "@/app/actions/debate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// HATA DÜZELTİLDİ: Sadece react-hot-toast kullanıyoruz
import toast from 'react-hot-toast'; 
import { cn } from "@/utils/cn";
import { Loader2, TrendingUp, AlertCircle } from "lucide-react";
import { useState, useTransition, useEffect } from "react";
import PersuasionModal from "@/components/social/debate/PersuasionModal";

interface Props {
  preloadedData?: Debate | null;
}

export default function DailyDebateWidget({ preloadedData }: Props) {
  const [isPending, startTransition] = useTransition();

  // State'leri güvenli başlatıyoruz
  const [debate, setDebate] = useState<Debate | null>(preloadedData || null);
  const [stats, setStats] = useState({ a: 0, b: 0 });
  const [userVote, setUserVote] = useState<'A' | 'B' | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalCandidates, setModalCandidates] = useState<any[]>([]);
  const [pendingChoice, setPendingChoice] = useState<'A' | 'B' | null>(null);

  // Veri geldiğinde state'i senkronize et
  useEffect(() => {
    if (preloadedData) {
      setDebate(preloadedData);
      setStats({ 
          a: preloadedData.stats?.a || 0, 
          b: preloadedData.stats?.b || 0 
      });
      setUserVote(preloadedData.userVote);
    }
  }, [preloadedData]);

  // Loading & Empty States
  if (!debate && !preloadedData) return (
      <div className="p-6 bg-white border border-slate-100 rounded-xl h-[200px] flex items-center justify-center text-slate-400">
          <Loader2 className="animate-spin mr-2" /> Yükleniyor...
      </div>
  );
  
  if (!debate) return null;

  // İstatistik Hesaplama (NaN koruması)
  const total = (stats.a || 0) + (stats.b || 0);
  const percentA = total === 0 ? 50 : Math.round((stats.a / total) * 100);
  const percentB = total === 0 ? 50 : 100 - percentA;

  // --- OY VERME MANTIĞI ---
  const handleVote = (choice: 'A' | 'B') => {
    // Zaten aynı oyu verdiyse işlem yapma
    if (userVote === choice) return;
    setPendingChoice(choice);

    startTransition(async () => {
        // 1. Optimistic Update (Ekranı hemen güncelle)
        const previousStats = { ...stats };
        const previousVote = userVote;
        
        setUserVote(choice);
        setStats(prev => ({
            a: choice === 'A' ? prev.a + 1 : (previousVote === 'A' ? prev.a - 1 : prev.a),
            b: choice === 'B' ? prev.b + 1 : (previousVote === 'B' ? prev.b - 1 : prev.b)
        }));

        // 2. Server Action Çağır
        const result = await voteDailyDebate(debate.id, choice);

        if (result.success) {
            toast.success("Oyunuz Kaydedildi: Topluluk nabzına katkıda bulundunuz.");
            // Serverdan gelen kesin veriyi işle (varsa)
            if (result.newStats) setStats(result.newStats);
            setPendingChoice(null);
        } 
        else if (result.requiresPersuasion) {
             // Limit dolduysa veya ikna gerekiyorsa Modalı aç
             setModalCandidates(result.candidates || []);
             setPendingChoice(choice);
             setIsModalOpen(true);
             
             // UI'ı geri al (Modalda onaylarsa tekrar güncelleyeceğiz)
             setUserVote(previousVote);
             setStats(previousStats);
             toast.custom((t) => (
                <div className="bg-amber-100 text-amber-800 p-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium">
                    <AlertCircle size={18} />
                    Fikir değiştirmek için birini ikna etmelisin!
                </div>
             ));
        } 
        else {
             // Hata durumunda geri al
             toast.error(result.error || "Bir hata oluştu");
             setUserVote(previousVote);
             setStats(previousStats);
             setPendingChoice(null);
        }
    });
  };

  // --- MODAL ONAYI (Fikir Değiştirme) ---
  const handlePersuasionConfirm = async (commentId: string) => {
      if (!pendingChoice) return;

      startTransition(async () => {
          const result = await confirmVoteChange(debate.id, pendingChoice, commentId);
          
          if (result.success) {
              setIsModalOpen(false);
              setUserVote(pendingChoice);
              if (result.newStats) setStats(result.newStats);
              setPendingChoice(null);
              toast.success("Fikir Değişikliği Onaylandı: Esnek bir zihne sahip olduğun için tebrikler!");
          } else {
              toast.error(result.error || "Değişiklik yapılamadı");
          }
      });
  };

  return (
    <>
        <Card className="w-full bg-gradient-to-br from-slate-50 to-white border-slate-200 shadow-sm overflow-hidden relative group hover:shadow-md transition-shadow">
             <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2 text-indigo-600 mb-1.5">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Günün Tartışması</span>
                </div>
                <CardTitle className="text-base font-bold text-slate-800 leading-snug min-h-[3rem] line-clamp-3">
                    {debate.title}
                </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4 px-4 pb-4">
                 {/* İstatistik Çubuğu */}
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        <span className={cn("transition-colors duration-300", userVote === 'A' && "text-indigo-600 scale-105")}>
                            %{percentA} KATILIYORUM
                        </span>
                        <span className={cn("transition-colors duration-300", userVote === 'B' && "text-rose-600 scale-105")}>
                            KATILMIYORUM %{percentB}
                        </span>
                    </div>
                    <div className="h-2 flex w-full rounded-full overflow-hidden bg-slate-100 border border-slate-100 relative">
                        {/* A Tarafı */}
                        <div 
                            className="h-full bg-indigo-500 transition-all duration-700 ease-out relative" 
                            style={{ width: `${percentA}%` }} 
                        />
                        {/* B Tarafı */}
                        <div 
                            className="h-full bg-rose-500 transition-all duration-700 ease-out relative" 
                            style={{ width: `${percentB}%` }} 
                        />
                        
                        {/* Orta Çizgi (Estetik) */}
                        <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-white mix-blend-overlay z-10 opacity-50"></div>
                    </div>
                </div>

                {/* Butonlar */}
                <div className="grid grid-cols-2 gap-2">
                    <Button
                        variant="outline"
                        className={cn(
                            "w-full text-xs h-9 font-bold border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition-all active:scale-95",
                            userVote === 'A' && "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 hover:text-white shadow-md shadow-indigo-200"
                        )}
                        onClick={() => handleVote('A')}
                        disabled={isPending}
                    >
                        {isPending && pendingChoice === 'A' ? <Loader2 className="w-3 h-3 animate-spin mr-1"/> : null}
                        A: Katılıyorum
                    </Button>

                    <Button
                        variant="outline"
                        className={cn(
                            "w-full text-xs h-9 font-bold border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition-all active:scale-95",
                            userVote === 'B' && "bg-rose-600 text-white border-rose-600 hover:bg-rose-700 hover:text-white shadow-md shadow-rose-200"
                        )}
                        onClick={() => handleVote('B')}
                        disabled={isPending}
                    >
                        {isPending && pendingChoice === 'B' ? <Loader2 className="w-3 h-3 animate-spin mr-1"/> : null}
                        B: Katılmıyorum
                    </Button>
                </div>
            </CardContent>
        </Card>

        {/* --- MODAL BURADA --- */}
        <PersuasionModal 
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setPendingChoice(null);
            }}
            candidates={modalCandidates}
            onConfirm={handlePersuasionConfirm}
            isSubmitting={isPending}
            targetSide={pendingChoice || 'A'}
        />
    </>
  );
}
