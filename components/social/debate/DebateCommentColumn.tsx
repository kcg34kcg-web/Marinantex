'use client';

import { useState, useEffect, useTransition } from "react";
import { Send, Lock, Loader2, Leaf, ThumbsUp, ThumbsDown, CheckCircle2, ShieldCheck, PenTool } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import toast from "react-hot-toast";
import { cn } from "@/utils/cn";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { createClient } from "@/utils/supabase/client";

// Actions & Components
import { getDebateComments, postDebateComment } from "@/app/actions/debate";
import PersuasionButton from "./PersuasionButton";

interface Props {
  debateId: string;
  userVote: 'A' | 'B' | null;
  isOpen: boolean;
}

export default function DebateCommentColumn({ debateId, userVote, isOpen }: Props) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasCommented, setHasCommented] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  const [content, setContent] = useState("");
  const [isPosting, startPosting] = useTransition();

  // Kullanıcı ID'sini al
  useEffect(() => {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data }) => {
          if (data.user) setCurrentUserId(data.user.id);
      });
  }, []);

  // Yorumları Çek
  useEffect(() => {
    if (isOpen) {
        setLoading(true);
        getDebateComments(debateId)
            .then(data => {
                const list = data || [];
                setComments(list);
                if (currentUserId) {
                    const myComment = list.find((c: any) => c.profiles?.id === currentUserId);
                    if (myComment) setHasCommented(true);
                }
            })
            .finally(() => setLoading(false));
    }
  }, [isOpen, debateId, currentUserId]);

  const commentsA = comments.filter(c => c.side === 'A');
  const commentsB = comments.filter(c => c.side === 'B');

  // --- YORUM GÖNDERME ---
  const handlePost = () => {
      if (!content.trim()) return;
      if (!userVote) {
          toast.error("Önce tarafını seçmelisin!");
          return;
      }

      startPosting(async () => {
          // 1. Sunucuya Gönder
          const result = await postDebateComment(debateId, content, userVote);
          
          if (result.success && result.savedData) {
              toast.success("Argümanınız başarıyla kayda geçti.", {
                  icon: '⚖️',
                  style: { borderRadius: '8px', background: '#333', color: '#fff' }
              });
              
              // 2. Gerçek Veriyi Listeye Ekle (Temp ID kullanmıyoruz artık)
              setComments(prev => [result.savedData, ...prev]);
              setContent(""); 
              setHasCommented(true);
          } else {
              toast.error(result.error || "Bir hata oluştu, tekrar deneyin.");
          }
      });
  };

  if (!isOpen) return null;

  // Taraf renkleri
  const themeColor = userVote === 'A' ? "emerald" : userVote === 'B' ? "rose" : "slate";
  const borderColor = userVote === 'A' ? "border-emerald-200" : userVote === 'B' ? "border-rose-200" : "border-slate-200";
  const bgSoft = userVote === 'A' ? "bg-emerald-50" : userVote === 'B' ? "bg-rose-50" : "bg-slate-50";

  return (
    <div className="bg-slate-50/50 border-t border-slate-100 min-h-[500px] relative font-sans">
       
       {/* ORTA GÖVDE ÇİZGİSİ */}
       <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-gradient-to-b from-slate-200 to-transparent -translate-x-1/2 z-0 hidden md:block"></div>

       {/* --- PROFESYONEL YORUM YAZMA ALANI --- */}
       <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm pt-6 pb-6 px-4">
           <div className="max-w-3xl mx-auto">
              
              <div className={cn(
                  "relative rounded-xl border transition-all duration-500 overflow-hidden group",
                  hasCommented ? "bg-slate-50 border-slate-200" : `bg-white ${borderColor} shadow-sm hover:shadow-md`
              )}>
                 
                 {/* KİLİT EKRANI (Yorum yapıldıysa veya taraf seçilmediyse) */}
                 {(!userVote || hasCommented) && (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-slate-50/80 z-20 backdrop-blur-[2px]">
                         {hasCommented ? (
                             <div className="flex flex-col items-center animate-in zoom-in duration-300">
                                <div className="bg-green-100 p-3 rounded-full mb-2">
                                    <ShieldCheck size={32} className="text-green-600" />
                                </div>
                                <span className="text-sm font-bold text-slate-700">Görüşün Kaydedildi</span>
                                <span className="text-xs text-slate-500">Bu tartışmada tek yorum hakkın var.</span>
                             </div>
                         ) : (
                             <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">
                                <Lock size={16} />
                                <span className="text-xs font-bold">Yazmak için taraf seçmelisin</span>
                             </div>
                         )}
                     </div>
                 )}

                 {/* TEXTAREA HEADER */}
                 {!hasCommented && userVote && (
                     <div className={cn("px-4 py-2 border-b flex items-center gap-2 text-xs font-bold uppercase tracking-wider", bgSoft, 
                        userVote === 'A' ? "text-emerald-700 border-emerald-100" : "text-rose-700 border-rose-100"
                     )}>
                        <PenTool size={12} />
                        {userVote === 'A' ? "Katılıyorum Çünkü..." : "Katılmıyorum Çünkü..."}
                     </div>
                 )}

                 <Textarea 
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={!userVote || isPosting || hasCommented}
                    placeholder="En güçlü argümanlarını buraya yaz. Topluluğu ikna et..."
                    className="min-h-[100px] border-0 focus-visible:ring-0 resize-none bg-transparent p-4 text-sm leading-relaxed placeholder:text-slate-400"
                 />
                 
                 {/* FOOTER & BUTTON */}
                 {!hasCommented && (
                     <div className="bg-slate-50 px-4 py-3 flex justify-between items-center border-t border-slate-100">
                        <span className="text-[10px] text-slate-400 font-medium hidden sm:inline-block">
                            *Hakaret ve nefret söylemi yasaktır.
                        </span>
                        
                        <Button 
                            onClick={handlePost}
                            disabled={!content.trim() || !userVote || isPosting}
                            className={cn(
                                "ml-auto px-6 font-bold text-xs transition-all transform active:scale-95 shadow-sm",
                                userVote === 'A' 
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white hover:shadow-emerald-200" 
                                    : "bg-rose-600 hover:bg-rose-700 text-white hover:shadow-rose-200"
                            )}
                        >
                            {isPosting ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Kaydediliyor...</>
                            ) : (
                                <><Send className="w-4 h-4 mr-2" /> Argümanı Yayınla</>
                            )}
                        </Button>
                     </div>
                 )}
              </div>
           </div>
       </div>

       {/* --- YORUM AĞACI --- */}
       {loading ? (
           <div className="flex flex-col items-center justify-center py-20 text-slate-400">
               <Loader2 className="animate-spin w-8 h-8 mb-2" />
               <span className="text-xs">Argümanlar yükleniyor...</span>
           </div>
       ) : (
           <div className="grid grid-cols-1 md:grid-cols-2 gap-0 relative z-10 max-w-6xl mx-auto">
               
               {/* SOL SÜTUN (A - YEŞİL) */}
               <div className="p-4 md:p-8 space-y-6 md:border-r border-slate-200/50">
                   <div className="sticky top-24 z-10 flex justify-center md:justify-start mb-6">
                       <span className="bg-white/80 backdrop-blur border border-emerald-100 text-emerald-700 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-sm flex items-center gap-2">
                           <ThumbsUp size={14} className="fill-emerald-100" /> Katılanlar ({commentsA.length})
                       </span>
                   </div>
                   
                   {commentsA.length === 0 && (
                       <div className="text-center py-12 opacity-50 border-2 border-dashed border-emerald-100 rounded-xl bg-emerald-50/30">
                           <Leaf className="w-10 h-10 mx-auto mb-2 text-emerald-300" />
                           <p className="text-xs font-medium text-emerald-800">Henüz katılan bir ses yok.</p>
                       </div>
                   )}

                   {commentsA.map((comment) => (
                       <div key={comment.id} className="flex gap-4 group animate-in fade-in slide-in-from-left-6 duration-700">
                           <Avatar className="w-10 h-10 border-2 border-white shadow-md mt-1 shrink-0 ring-2 ring-emerald-50">
                               <AvatarImage src={comment.profiles?.avatar_url} />
                               <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700 font-bold">
                                   {comment.profiles?.full_name?.substring(0,2).toUpperCase()}
                               </AvatarFallback>
                           </Avatar>
                           <div className="flex-1 relative">
                               <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden">
                                   <div className="absolute top-0 left-0 w-1 h-full bg-emerald-400"></div>
                                   <div className="flex justify-between items-start mb-2">
                                       <div>
                                           <h4 className="text-sm font-bold text-slate-800">{comment.profiles?.full_name}</h4>
                                           <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">
                                               {comment.profiles?.job_title || "Üye"}
                                           </span>
                                       </div>
                                       <span className="text-[10px] text-slate-300">
                                           {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: tr })}
                                       </span>
                                   </div>
                                   <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                                       {comment.content}
                                   </p>
                               </div>
                               <div className="mt-2 ml-2">
                                   <PersuasionButton 
                                       debateId={debateId}
                                       commentId={comment.id}
                                       authorId={comment.profiles?.id}
                                       initialCount={comment.persuasion_count || 0}
                                       userSide={userVote}
                                       commentSide="A"
                                   />
                               </div>
                           </div>
                       </div>
                   ))}
               </div>

               {/* SAĞ SÜTUN (B - KIRMIZI) */}
               <div className="p-4 md:p-8 space-y-6">
                   <div className="sticky top-24 z-10 flex justify-center md:justify-end mb-6">
                       <span className="bg-white/80 backdrop-blur border border-rose-100 text-rose-700 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-sm flex items-center gap-2">
                           Katılmayanlar ({commentsB.length}) <ThumbsDown size={14} className="fill-rose-100" />
                       </span>
                   </div>

                   {commentsB.length === 0 && (
                       <div className="text-center py-12 opacity-50 border-2 border-dashed border-rose-100 rounded-xl bg-rose-50/30">
                           <Leaf className="w-10 h-10 mx-auto mb-2 text-rose-300" />
                           <p className="text-xs font-medium text-rose-800">Henüz karşıt bir ses yok.</p>
                       </div>
                   )}

                   {commentsB.map((comment) => (
                       <div key={comment.id} className="flex flex-row-reverse gap-4 group animate-in fade-in slide-in-from-right-6 duration-700">
                           <Avatar className="w-10 h-10 border-2 border-white shadow-md mt-1 shrink-0 ring-2 ring-rose-50">
                               <AvatarImage src={comment.profiles?.avatar_url} />
                               <AvatarFallback className="text-xs bg-rose-100 text-rose-700 font-bold">
                                   {comment.profiles?.full_name?.substring(0,2).toUpperCase()}
                               </AvatarFallback>
                           </Avatar>
                           <div className="flex-1 relative text-right">
                               <div className="bg-white p-4 rounded-2xl rounded-tr-none border border-slate-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden">
                                   <div className="absolute top-0 right-0 w-1 h-full bg-rose-400"></div>
                                   <div className="flex justify-between items-start mb-2 flex-row-reverse">
                                       <div>
                                           <h4 className="text-sm font-bold text-slate-800">{comment.profiles?.full_name}</h4>
                                           <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">
                                               {comment.profiles?.job_title || "Üye"}
                                           </span>
                                       </div>
                                       <span className="text-[10px] text-slate-300">
                                           {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: tr })}
                                       </span>
                                   </div>
                                   <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                                       {comment.content}
                                   </p>
                               </div>
                               <div className="mt-2 mr-2 flex justify-end">
                                   <PersuasionButton 
                                       debateId={debateId}
                                       commentId={comment.id}
                                       authorId={comment.profiles?.id}
                                       initialCount={comment.persuasion_count || 0}
                                       userSide={userVote}
                                       commentSide="B"
                                   />
                               </div>
                           </div>
                       </div>
                   ))}
               </div>

           </div>
       )}
    </div>
  );
}