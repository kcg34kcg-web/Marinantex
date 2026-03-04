'use client';

import { useState, useEffect } from 'react';
import { Poll } from '@/app/types'; // types.ts'i güncellemiştik, oradan alıyor
import { castPollVote } from '@/app/actions/poll-actions';
import { cn } from '@/utils/cn'; 
import toast from 'react-hot-toast'; 
import { CheckCircle2, Clock, Users } from 'lucide-react';
import PollVotersModal from './poll-voters-modal'; // YENİ: Modal importu

interface PollCardProps {
  poll: Poll;
  currentUserId?: string;
}

export default function PollCard({ poll: initialPoll, currentUserId }: PollCardProps) {
  const [poll, setPoll] = useState<Poll>(initialPoll);
  const [isVoting, setIsVoting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false); // YENİ: Modal state'i

  useEffect(() => {
    setPoll(initialPoll);
  }, [initialPoll]);

  // --- TOPLAM OY HESAPLAMA ---
  // Her bir seçeneğin 'vote_count' değerini topluyoruz.
  const totalVotes = poll.options?.reduce((acc, opt) => acc + (opt.vote_count || 0), 0) || 0;
  
  const isExpired = new Date(poll.expires_at) < new Date();
  
  // Sonuçları gösterme şartı: Kullanıcı oy verdiyse VEYA süre dolduysa VEYA anket kapandıysa
  const showResults = !!poll.user_vote || isExpired || poll.is_closed;

  const handleVote = async (optionId: string) => {
    if (!currentUserId) {
      toast.error("Oy kullanmak için giriş yapmalısın.");
      return;
    }
    if (isVoting || isExpired) return;

    // 1. OPTIMISTIC UPDATE (Anlık Arayüz Güncellemesi)
    const previousPoll = { ...poll };
    const oldOptionId = poll.user_vote;
    const isRetracting = oldOptionId === optionId;

    const newOptions = poll.options.map(opt => {
      let change = 0;
      if (opt.id === optionId) change = isRetracting ? -1 : 1;     // Yeni seçilene +1 (veya geri çekiliyorsa -1)
      if (!isRetracting && opt.id === oldOptionId) change = -1;    // Eski seçilenden -1
      
      return { ...opt, vote_count: (opt.vote_count || 0) + change };
    });

    setPoll({
      ...poll,
      options: newOptions,
      user_vote: isRetracting ? null : optionId
    });
    setIsVoting(true);

    // 2. SUNUCU İSTEĞİ
    const result = await castPollVote(poll.id, optionId);

    // 3. HATA DURUMUNDA GERİ AL
    if (result.error) {
      setPoll(previousPoll);
      toast.error(result.error);
    } else if (result.status === 'retracted') {
        toast.success("Oyun geri çekildi");
    }
    
    setIsVoting(false);
  };

  // Kalan süreyi formatla
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm my-4 hover:shadow-md transition-shadow">
      
      {/* YENİ: MODAL BİLEŞENİ (Eğer state true ise render olur) */}
      {isModalOpen && (
        <PollVotersModal 
           poll={poll} 
           isOpen={isModalOpen} 
           onClose={() => setIsModalOpen(false)} 
        />
      )}

      {/* HEADER */}
      <div className="mb-4">
        <h3 className="text-lg font-bold text-slate-900 leading-snug">
          {poll.question}
        </h3>
        
        <div className="flex items-center text-xs text-slate-500 mt-2 space-x-3 font-medium">
          {/* OY SAYISI GÖSTERGESİ (TIKLANABİLİR YAPILDI) */}
          <button 
             onClick={() => !poll.is_anonymous && totalVotes > 0 && setIsModalOpen(true)}
             disabled={poll.is_anonymous || totalVotes === 0}
             className={cn(
               "flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full transition-colors",
               !poll.is_anonymous && totalVotes > 0 
                  ? "text-blue-600 hover:bg-blue-100 cursor-pointer" 
                  : "text-slate-500 cursor-default opacity-80"
             )}
             title={poll.is_anonymous ? "Anonim anketlerde detaylar görüntülenemez" : "Oy verenleri gör"}
          >
             <Users size={12} />
             {totalVotes} oy
          </button>

          <span className="text-slate-300">•</span>
          
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {isExpired ? "Sona Erdi" : `Bitiş: ${formatDate(poll.expires_at)}`}
          </span>

          {poll.is_anonymous && (
             <>
                <span className="text-slate-300">•</span>
                <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">
                  Anonim
                </span>
             </>
          )}
        </div>
      </div>

      {/* SEÇENEKLER */}
      <div className="space-y-2.5">
        {poll.options
          .sort((a, b) => a.display_order - b.display_order)
          .map((option) => {
            // Yüzde Hesaplama
            const percentage = totalVotes === 0 ? 0 : Math.round(((option.vote_count || 0) / totalVotes) * 100);
            const isSelected = poll.user_vote === option.id;

            return (
              <button
                key={option.id}
                onClick={() => handleVote(option.id)}
                disabled={(showResults && !isSelected && isExpired) || isVoting} 
                className={cn(
                  "relative w-full text-left min-h-[48px] rounded-xl text-sm overflow-hidden transition-all group",
                  // Kenarlık ve Hover Durumları
                  isSelected 
                    ? "ring-2 ring-blue-500 border-transparent" 
                    : "border border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                )}
              >
                {/* İlerleme Çubuğu (Background) - Sadece sonuçlar açıkken görünür */}
                {showResults && (
                  <div 
                    className={cn(
                      "absolute top-0 left-0 h-full transition-all duration-500 ease-out opacity-20",
                      isSelected ? "bg-blue-500" : "bg-slate-400"
                    )}
                    style={{ width: `${percentage}%` }}
                  />
                )}

                {/* İçerik (Metin ve Yüzde) */}
                <div className="relative z-10 flex justify-between items-center px-4 py-3 h-full">
                  <div className="flex items-center gap-2">
                      {/* Seçili İkonu */}
                      {isSelected && <CheckCircle2 size={16} className="text-blue-600 shrink-0 animate-in zoom-in" />}
                      
                      <span className={cn(
                        "font-medium truncate pr-2",
                        isSelected ? "text-blue-700" : "text-slate-700"
                      )}>
                        {option.option_text}
                      </span>
                  </div>
                  
                  {/* Yüzde Göstergesi */}
                  {showResults && (
                    <span className="text-sm font-bold text-slate-600 tabular-nums">
                      %{percentage}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
      </div>
      
      {/* Alt Bilgi (Opsiyonel) */}
      {!showResults && !isExpired && (
        <p className="text-[11px] text-slate-400 mt-3 text-center">
          Sonuçları görmek için oy kullanın
        </p>
      )}
    </div>
  );
}