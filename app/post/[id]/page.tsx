'use client';

import { createClient } from '@/utils/supabase/client';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import moment from 'moment';
import Link from 'next/link';
import Image from 'next/image';
import 'moment/locale/tr';

import { 
  ArrowLeft, Loader2, User, MapPin, Ticket, QrCode, Clock, MoreHorizontal,
  Clapperboard, Music, Mic2, Theater, Video, GraduationCap, Palette, Film
} from 'lucide-react';

import CommentSection from '@/components/CommentSection';
import EventLifecycle from '@/components/EventLifecycle';
import ReactionBar from '@/components/ReactionBar';
import AddToCalendarBtn from '@/components/AddToCalendarBtn';

interface Post { 
  id: string; 
  content: string; 
  user_id: string; 
  created_at: string; 
  image_url?: string;
  profiles: { full_name: string; avatar_url: string; username: string; }; 
  is_event?: boolean;
  event_date?: string;
  event_location?: any; 
  woow_count?: number; 
  doow_count?: number; 
  adil_count?: number; 
  comment_count?: number; 
  my_reaction?: string;
} 

// --- ARKA PLAN (Hafif ve Performanslı) ---
const AnimatedBackground = () => {
  const icons = [
    <Clapperboard key="1" size={64} />, <Music key="2" size={64} />, <Mic2 key="3" size={64} />,
    <Film key="4" size={64} />, <Video key="5" size={64} />, <Palette key="6" size={64} />,
    <Theater key="7" size={64} />, <Ticket key="8" size={64} />, <GraduationCap key="9" size={64} />
  ];

  const IconRow = ({ duration, direction, opacity }: { duration: string, direction: 'normal' | 'reverse', opacity: string }) => (
    <div className="flex gap-24 py-12 overflow-hidden whitespace-nowrap select-none pointer-events-none" 
         style={{ 
           maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
           opacity: opacity 
         }}>
      <div className="flex gap-24 min-w-full shrink-0 animate-marquee" style={{ animationDuration: duration, animationDirection: direction }}>
        {[...icons, ...icons].map((icon, i) => (
          <div key={i} className="text-slate-400">{icon}</div>
        ))}
      </div>
      <div className="flex gap-24 min-w-full shrink-0 animate-marquee" style={{ animationDuration: duration, animationDirection: direction }}>
        {[...icons, ...icons].map((icon, i) => (
          <div key={i} className="text-slate-400">{icon}</div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-0 bg-[#eff2f6] h-screen w-screen pointer-events-none">
      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
        .animate-marquee {
          animation: marquee linear infinite;
          will-change: transform;
        }
      `}</style>
      
      {/* Ortam Işıkları */}
      <div className="absolute top-0 left-0 w-[60vw] h-[60vw] bg-blue-100/50 rounded-full blur-[100px] mix-blend-multiply opacity-50"></div>
      <div className="absolute bottom-0 right-0 w-[60vw] h-[60vw] bg-orange-100/50 rounded-full blur-[100px] mix-blend-multiply opacity-50"></div>

      <div className="absolute inset-0 flex flex-col justify-between -rotate-[5deg] scale-110 opacity-10">
        <IconRow duration="70s" direction="normal" opacity="0.4" />
        <IconRow duration="60s" direction="reverse" opacity="0.3" />
        <IconRow duration="80s" direction="normal" opacity="0.4" />
        <IconRow duration="65s" direction="reverse" opacity="0.3" />
      </div>
    </div>
  );
};

export default function PostDetailPage() { 
  const params = useParams(); 
  const id = params?.id as string; 
  const router = useRouter();
  const supabase = createClient(); 

  const [post, setPost] = useState<Post | null>(null); 
  const [isLoading, setIsLoading] = useState(true); 
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => { 
    const fetchData = async () => { 
      try { 
        setIsLoading(true); 
        if (!id) return; 

        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserId(user?.id || null);
          
        const { data, error } = await supabase 
          .from('posts') 
          .select(`*, profiles(full_name, avatar_url, username)`) 
          .eq('id', id) 
          .maybeSingle(); 

        if (error) throw error; 
        setPost(data as any); 
          
      } catch (error) { 
        console.error("Detay yükleme hatası:", error); 
      } finally { 
        setIsLoading(false); 
      } 
    };

    fetchData(); 
    moment.locale('tr'); 
  }, [id]); 

  // --- HEADER (FIXED, ANIMASYONLU BUTON) ---
  const FixedHeader = () => (
    <header className="fixed top-0 left-0 right-0 w-full h-[72px] z-50 bg-[#eff2f6]/95 backdrop-blur-md border-b border-slate-200 shadow-sm flex items-center">
       <div className="w-full max-w-5xl mx-auto px-4 md:px-6 flex items-center justify-between">
           
           {/* SOL: YENİ LEXWOOW BUTONU (Animasyonlu) */}
           <Link href="/social" className="group relative flex items-center gap-3 px-5 py-2 rounded-full bg-[#0f172a] overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_-5px_rgba(249,115,22,0.6)] active:scale-95 border border-white/10">
               
               {/* Arka plan ışık efekti (Hover'da geçer) */}
               <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-150%] group-hover:translate-x-[150%] transition-transform duration-700 ease-in-out z-0"></div>

               {/* İkon */}
               <div className="relative z-10 w-8 h-8 flex items-center justify-center bg-white/10 backdrop-blur-sm rounded-full text-lg shadow-inner border border-white/10 transition-all duration-500 group-hover:bg-orange-500 group-hover:text-white group-hover:rotate-180">
                  <span>🍊</span>
               </div>

               {/* Yazı: Beyaz'dan Gradient'e geçiş */}
               <span className="relative z-10 font-black text-xl tracking-[0.2em] text-white transition-all duration-300 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-orange-400 group-hover:to-amber-300">
                   LEXWOOW
               </span>
           </Link>

           {/* SAĞ: MENÜ */}
           <button className="w-10 h-10 flex items-center justify-center bg-white hover:bg-orange-50 text-[#0f172a] hover:text-orange-600 rounded-full border border-slate-200 shadow-sm transition-all active:scale-95">
               <MoreHorizontal size={20} />
           </button>
       </div>
    </header>
  );

  const EventHero = ({ p }: { p: Post }) => {
    const eventDate = p.event_date ? new Date(p.event_date) : new Date();
    const locationName = typeof p.event_location === 'object' ? p.event_location?.name : p.event_location;

    return (
      <div className="bg-white border border-white/50 rounded-3xl overflow-hidden shadow-xl shadow-slate-300/40 relative group animate-in fade-in slide-in-from-bottom-4">
        
        {/* Dekoratif */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-50 rounded-full blur-3xl -z-0 translate-x-1/2 -translate-y-1/2 opacity-80"></div>

        {/* Bilet Header */}
        <div className="bg-[#0f172a] px-6 py-4 flex items-center justify-between border-b-4 border-orange-500 z-10 relative text-white">
           <div className="flex items-center gap-2 text-xs font-black tracking-[0.2em] uppercase text-orange-400">
              <Ticket size={16} className="text-orange-500" />
              <span>Dijital Bilet</span>
           </div>
           <div className="text-slate-400 text-xs font-mono bg-white/10 px-2 py-1 rounded">ID: #{p.id.slice(0, 8)}</div>
        </div>

        <div className="flex flex-col md:flex-row relative z-10">
            {/* SOL */}
            <div className="flex-1 p-6 md:p-8 flex flex-col justify-between">
                <div>
                   <div className="flex flex-wrap gap-3 mb-6">
                      <div className="group/author flex items-center gap-2 text-slate-700 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-orange-400 hover:bg-orange-50 transition-all cursor-pointer" onClick={() => router.push(`/profile/${p.user_id}`)}>
                         <User size={16} className="text-slate-400 group-hover/author:text-orange-500" />
                         <span className="font-bold text-sm group-hover/author:text-orange-600 transition-colors">{p.profiles?.full_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-700 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                         <MapPin size={16} className="text-blue-600" />
                         <span className="font-bold text-sm">{locationName || 'Online'}</span>
                      </div>
                   </div>
                   
                   <h1 className="text-2xl md:text-3xl font-black text-[#0f172a] leading-tight mb-4">
                      {p.content}
                   </h1>
                </div>
            </div>

            {/* Çizgi */}
            <div className="relative md:w-1 md:h-auto h-1 w-full flex items-center justify-center bg-white">
                 <div className="absolute md:-top-3 -left-3 md:left-auto w-6 h-6 rounded-full bg-[#eff2f6] border border-slate-200 z-20"></div>
                 <div className="absolute md:-bottom-3 -right-3 md:right-auto w-6 h-6 rounded-full bg-[#eff2f6] border border-slate-200 z-20"></div>
                 <div className="w-full h-full md:border-l-2 border-t-2 md:border-t-0 border-dashed border-slate-200"></div>
            </div>

            {/* SAĞ */}
            <div className="w-full md:w-80 bg-slate-50/50 p-6 md:p-8 flex flex-col items-center justify-center text-center gap-4 border-l-0 md:border-l border-slate-100 relative">
                 <div className="flex flex-col items-center">
                    <span className="text-orange-600 font-bold uppercase tracking-widest text-xs mb-1">
                        {moment(eventDate).format('MMMM')}
                    </span>
                    <span className="text-5xl font-black text-[#0f172a] tracking-tighter leading-none">
                        {moment(eventDate).format('DD')}
                    </span>
                    <span className="text-slate-500 text-sm font-medium mt-1 flex items-center gap-1.5 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                        <Clock size={12} className="text-orange-500" /> {moment(eventDate).format('HH:mm')}
                    </span>
                 </div>

                 <div className="bg-white p-2 rounded-xl shadow-md border border-slate-100 group-hover:scale-105 transition-transform duration-300">
                     <QrCode size={80} className="text-[#0f172a]" />
                 </div>
                 
                 <div className="w-full mt-2 scale-95 flex flex-col gap-2">
                     <EventLifecycle eventId={p.id} eventDate={p.event_date!} locationName={locationName} />
                     <AddToCalendarBtn eventTitle={p.content.slice(0, 60)} eventDate={p.event_date!} locationName={locationName} />
                 </div>
            </div>
        </div>
      </div>
    );
  };

  if (isLoading) return <div className="min-h-screen bg-[#eff2f6] flex justify-center items-center"><Loader2 className="animate-spin text-orange-500 w-10 h-10" /></div>; 
  if (!post) return <div className="min-h-screen bg-[#eff2f6] flex justify-center items-center text-slate-500 font-medium">İçerik bulunamadı veya silinmiş.</div>; 

  return ( 
    <div className="min-h-screen bg-[#eff2f6] font-sans text-slate-900 selection:bg-orange-100 selection:text-orange-900"> 
      
      {/* 1. ARKA PLAN */}
      <AnimatedBackground />

      {/* 2. HEADER */}
      <FixedHeader />

      {/* 3. İÇERİK */}
      <main className="relative z-10 w-full max-w-5xl mx-auto px-4 md:px-6 pt-28 pb-20 flex flex-col gap-8">
          
          {post.is_event ? (
             <EventHero p={post} />
          ) : (
             // Standart Post
             <div className="bg-white border border-white/60 rounded-3xl p-6 shadow-xl shadow-slate-300/30 relative overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-amber-500"></div>
                <div className="flex items-center gap-3 mb-4">
                   <div className="w-12 h-12 rounded-full bg-slate-100 overflow-hidden relative border border-slate-100 cursor-pointer shadow-sm" onClick={() => router.push(`/profile/${post.user_id}`)}>
                       <Image src={post.profiles?.avatar_url || '/default-avatar.png'} alt="avatar" fill className="object-cover" />
                   </div>
                   <div>
                       <div className="text-[#0f172a] font-bold text-lg leading-tight cursor-pointer hover:text-orange-600 transition-colors" onClick={() => router.push(`/profile/${post.user_id}`)}>{post.profiles?.full_name}</div>
                       <div className="text-xs text-slate-500 font-medium">@{post.profiles?.username} • {moment(post.created_at).fromNow()}</div>
                   </div>
                </div>
                <p className="text-slate-800 text-lg whitespace-pre-wrap leading-relaxed">{post.content}</p>
                {post.image_url && (
                   <div className="mt-4 relative h-64 md:h-96 w-full rounded-2xl overflow-hidden shadow-sm group">
                       <Image src={post.image_url} alt="post" fill className="object-cover group-hover:scale-105 transition-transform duration-500" />
                   </div>
                )}
             </div>
          )}

          {/* YORUMLAR */}
          <div className="bg-white border border-white/60 rounded-3xl overflow-hidden shadow-xl shadow-slate-300/30 animate-in fade-in slide-in-from-bottom-8">
             {/* Sticky Header inside Comments */}
             <div className="p-4 border-b border-slate-100 bg-slate-50/90 backdrop-blur-sm sticky top-[72px] z-30 transition-all">
                 <ReactionBar 
                    targetId={post.id}
                    targetType="post"
                    initialCounts={{
                      woow: post.woow_count || 0,
                      doow: post.doow_count || 0,
                      adil: post.adil_count || 0,
                      comment_count: post.comment_count || 0
                    }}
                    initialUserReaction={(post.my_reaction as 'woow' | 'doow' | 'adil') || null}
                    isOwner={currentUserId === post.user_id}
                 />
             </div>
             <div className="p-4 md:p-8 bg-white/95 min-h-[300px]">
                 <h3 className="text-[#0f172a] font-bold mb-6 flex items-center gap-2 text-xl">
                     Yorumlar <span className="text-sm bg-orange-100 text-orange-600 px-2.5 py-0.5 rounded-full font-black">{post.comment_count || 0}</span>
                 </h3>
                 <CommentSection postId={post.id} postOwnerId={post.user_id} />
             </div>
          </div>

      </main> 
    </div> 
  ); 
}