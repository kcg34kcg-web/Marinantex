'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { Loader2, CheckCircle2, Sparkles, BrainCircuit, ArrowRight } from 'lucide-react';
import LoungeContainer from '@/components/lounge/LoungeContainer'; 
import toast from 'react-hot-toast';

export default function LoungePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  
  // URL'den parametreleri al (Hem yeni hem eski sistemi destekler)
  const jobId = searchParams.get('jobId');       // Yeni Sistem (Öncelikli)
  const questionId = searchParams.get('questionId') || searchParams.get('id'); // Eski Sistem

  // Durum Yönetimi
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'analyzing' | 'completed' | 'failed'>('analyzing');
  const [statusText, setStatusText] = useState('Sistem hazırlanıyor...');

  const goToResult = () => {
    if (questionId) router.push(`/questions/${questionId}`);
    else router.push('/my-questions'); // Fallback
  };

  // 1. GÖRSEL İLERLEME (Fake Progress - Psikolojik)
  useEffect(() => {
    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        // Eğer işlem bittiyse %100 yap
        if (status === 'completed') return 100;
        
        // %90'da takılı kalsın (Bitene kadar)
        if (prev >= 90) return 90;

        // İlk %30 hızlı, sonrası yavaş
        const increment = prev < 30 ? 2 : 0.5; 
        return Math.min(prev + increment, 90);
      });
    }, 100);

    return () => clearInterval(progressTimer);
  }, [status]);

  // 2. TETİKLEME (TRIGGER) - Sadece JobID varsa
  // --- GÜNCELLENEN KISIM BURASI ---
  useEffect(() => {
    if (!jobId) return;

    const triggerAI = async () => {
      try {
        // Doğru API rotasını çağırıyoruz
        await fetch('/api/process-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        });
      } catch (e) {
        console.error("AI Tetiklenemedi:", e);
      }
    };
    // Sadece bir kere çalışsın
    triggerAI();
  }, [jobId]);

  // 3. CANLI TAKİP (REALTIME) - Yeni Motor
  useEffect(() => {
    // A) Yeni Sistem (Research Jobs)
    if (jobId) {
      console.log("📡 Canlı takip (Job):", jobId);
      
      const channel = supabase
        .channel(`job-${jobId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'research_jobs', filter: `id=eq.${jobId}` },
          (payload) => {
            const newStatus = payload.new.status;
            console.log("⚡ Durum:", newStatus);

            if (newStatus === 'processing') {
              setStatusText('Hukuki kaynaklar taranıyor...');
            } else if (newStatus === 'completed') {
              setStatus('completed');
              setProgress(100);
              setStatusText('Analiz Hazır! Görüntüle');
              toast.success("Cevabınız Hazır!");
            } else if (newStatus === 'failed') {
               setStatus('failed');
               setStatusText('İşlem başarısız oldu.');
            }
          }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    } 
    
    // B) Eski Sistem (Questions Tablosu - Geriye Dönük Uyumluluk)
    else if (questionId) {
      console.log("📡 Canlı takip (Question):", questionId);
      setStatusText('Vaka inceleniyor...');

      const channel = supabase
        .channel(`q-${questionId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'questions', filter: `id=eq.${questionId}` },
          (payload) => {
             if (payload.new.status === 'answered') {
                setStatus('completed');
                setProgress(100);
                setStatusText('Analiz Hazır!');
             }
          }
        )
        .subscribe();

       // Polling Fallback (Eski kodundan)
       const checkStatus = async () => {
         const { data } = await supabase.from('questions').select('status').eq('id', questionId).single();
         if (data?.status === 'answered') setStatus('completed');
       };
       const poller = setInterval(checkStatus, 3000);

       return () => { 
         supabase.removeChannel(channel); 
         clearInterval(poller);
       };
    }
  }, [jobId, questionId, supabase]);

  // 4. GÜVENLİK (Timeout)
  useEffect(() => {
    const timer = setTimeout(() => {
       if (status !== 'completed') {
          // Çok uzun sürdüyse "Hazır" gibi davranıp sayfaya gönderelim,
          // Kullanıcı sayfaya gidince zaten datayı görecek (veya loading görecek)
          setStatus('completed');
          setStatusText('Analiz Sonuçlanıyor...');
       }
    }, 45000); // 45 saniye limit (Derin araştırma uzun sürebilir)
    return () => clearTimeout(timer);
  }, [status]);


  return (
    <div className="relative min-h-screen">
      
      {/* 1. OYUN ALANI (Mevcut Tasarım) */}
      <div className="relative z-0">
         <LoungeContainer />
      </div>

      {/* 2. DURUM WIDGET'I (Mevcut Tasarımın Aynısı) */}
      <div className="fixed top-4 left-4 z-50 animate-in slide-in-from-left-5 duration-700 group">
        
        <button 
           onClick={status === 'completed' ? goToResult : undefined}
           disabled={status === 'analyzing'}
           className={`
               relative overflow-hidden
               backdrop-blur-md border 
               p-4 rounded-2xl shadow-2xl flex flex-col gap-3 min-w-[260px] text-left transition-all duration-300
               ${status === 'completed' 
                   ? 'bg-green-900/80 border-green-400/50 cursor-pointer hover:scale-105 hover:shadow-green-500/20 animate-pulse-slow' 
                   : status === 'failed'
                   ? 'bg-red-900/80 border-red-400/50'
                   : 'bg-black/60 border-white/10 cursor-wait'}
           `}
        >
           {/* Yanıp Sönen Yeşil Glow Efekti */}
           {status === 'completed' && (
             <div className="absolute inset-0 bg-green-500/10 animate-pulse pointer-events-none"></div>
           )}

           {/* Başlık ve İkon */}
           <div className="flex items-center gap-3 relative z-10">
              {status === 'analyzing' ? (
                <div className="relative">
                    <div className="absolute inset-0 bg-indigo-500 blur-lg opacity-40 animate-pulse"></div>
                    <BrainCircuit className="w-6 h-6 text-indigo-400 animate-pulse" />
                </div>
              ) : status === 'failed' ? (
                <div className="bg-red-500 text-white p-1 rounded-full shadow-lg">!</div>
              ) : (
                <div className="bg-green-500 text-white p-1 rounded-full shadow-lg shadow-green-500/40 animate-bounce">
                    <CheckCircle2 className="w-6 h-6" />
                </div>
              )}
              
              <div className="flex flex-col">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${
                    status === 'completed' ? 'text-green-300' : 
                    status === 'failed' ? 'text-red-300' : 'text-indigo-300'
                  }`}>
                    Babylexit AI
                  </span>
                  <div className="flex items-center gap-1">
                      <span className="text-sm font-bold text-white leading-tight">{statusText}</span>
                      {status === 'completed' && <ArrowRight size={14} className="text-white animate-wobble" />}
                  </div>
              </div>
           </div>

           {/* İlerleme Çubuğu */}
           <div className="w-full bg-black/20 h-1.5 rounded-full overflow-hidden relative z-10">
              <div 
                className={`h-full transition-all duration-500 ease-out ${
                    status === 'completed' ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.7)]' : 
                    status === 'failed' ? 'bg-red-500' :
                    'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'
                }`}
                style={{ width: `${progress}%` }}
              ></div>
           </div>

           {/* Alt Bilgi */}
           <div className="flex justify-between items-center text-[10px] text-white/50 font-medium relative z-10">
              <span>{Math.round(progress)}%</span>
              <span className="flex items-center gap-1">
                 {status === 'completed' 
                    ? <span className="text-green-200 font-bold">Sonucu görmek için tıkla</span>
                    : <><Sparkles size={8} /> Beklerken keşfedin</>
                 }
              </span>
           </div>

        </button>
      </div>

      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 rgba(0,0,0,0); }
          50% { transform: scale(1.02); box-shadow: 0 10px 25px -5px rgba(34, 197, 94, 0.4); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s infinite;
        }
        @keyframes wobble {
            0%, 100% { transform: translateX(0); }
            50% { transform: translateX(3px); }
        }
        .animate-wobble {
            animation: wobble 1s infinite ease-in-out;
        }
      `}</style>

    </div>
  );
}
