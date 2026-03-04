'use client';

// ... (Importlar aynı kalsın, sadece CalendarPlus'ı silebilirsin)
import { useState, useEffect } from 'react';
import { isPast, isToday, isFuture } from 'date-fns';
import { MapPin, Ticket, Camera, CheckCircle2, Loader2, XCircle } from 'lucide-react'; // CalendarPlus silindi
import { cn } from '@/utils/cn';
import { createClient } from '@/utils/supabase/client';
import toast from 'react-hot-toast';

interface EventLifecycleProps {
  eventId: string;
  eventDate: string | Date;
  // locationName ve eventTitle artık burada GEREKSİZ, silebiliriz ama kalsa da zarar vermez.
  locationName?: string | null; 
  eventTitle?: string;
}

export default function EventLifecycle({ eventId, eventDate }: EventLifecycleProps) {
  const supabase = createClient();
  const dateObj = new Date(eventDate);
  
  const [status, setStatus] = useState<'none' | 'going'>('none');
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(false);

  // Tarih Durumları
  const isLive = isToday(dateObj);
  const isEnded = isPast(dateObj) && !isToday(dateObj);
  const isUpcoming = isFuture(dateObj) && !isToday(dateObj);

  // --- BURADAKİ CALENDAR FONKSİYONUNU SİLDİK ---

  // 1. Katılım Kontrolü
  useEffect(() => {
    const checkParticipation = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setLoading(false);

      const { data } = await supabase
        .from('event_participants')
        .select('status')
        .eq('user_id', user.id)
        .eq('post_id', eventId)
        .maybeSingle();

      if (data) setStatus('going');
      setLoading(false);
    };

    if (eventId) checkParticipation();
  }, [eventId]);

  // 2. Katılım İşlemi (Aynen Kalıyor)
  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return toast.error("Giriş yapmalısın!");

    const oldStatus = status;
    const newStatus = status === 'going' ? 'none' : 'going';
    setStatus(newStatus);

    try {
      if (newStatus === 'going') {
        const { error } = await supabase
          .from('event_participants')
          .insert({ user_id: user.id, post_id: eventId, status: 'going' });
        if (error) throw error;
        toast.success("Listeye eklendin!");
      } else {
        const { error } = await supabase
          .from('event_participants')
          .delete()
          .eq('user_id', user.id)
          .eq('post_id', eventId);
        if (error) throw error;
        toast("Katılım iptal edildi.");
      }
    } catch (err) {
      console.error(err);
      setStatus(oldStatus);
      toast.error("Hata oluştu.");
    }
  };

  if (loading) {
    return (
      <button className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-400 animate-pulse">
        <Loader2 size={14} className="animate-spin" />
      </button>
    );
  }

  // --- RENDER (Sadece Tek Buton Kaldı) ---
  
  if (isEnded) {
      return (
        <button disabled className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide border border-slate-100 text-slate-400 bg-slate-50 cursor-not-allowed">
            <Camera size={14} /> <span>Sona Erdi</span>
        </button>
      );
  }

  if (isLive) {
    return (
      <button 
        onClick={handleToggle}
        className={cn(
          "mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all shadow-sm",
          status === 'going'
            ? "bg-green-100 text-green-700 border border-green-200"
            : "bg-red-600 hover:bg-red-500 text-white animate-pulse shadow-red-200"
        )}
      >
        {status === 'going' ? <><CheckCircle2 size={14} /> Buradasın</> : <><MapPin size={14} className="animate-bounce" /> Check-in</>}
      </button>
    );
  }

  // Gelecek Etkinlik
  return (
    <button 
        onClick={handleToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn(
        "mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all shadow-sm",
        status === 'going'
            ? hover 
                ? "bg-red-50 text-red-600 border border-red-200"
                : "bg-green-100 text-green-700 border border-green-200"
            : "bg-blue-600 text-white hover:bg-blue-500 shadow-blue-200"
        )}
    >
        {status === 'going' ? (
            hover ? <><XCircle size={14} /> Vazgeç</> : <><CheckCircle2 size={14} /> Gidiyorum</>
        ) : (
            <><Ticket size={14} /> Katıl</>
        )}
    </button>
  );
}