'use client';

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";
import { Comment } from "@/app/actions/debate/types";
import PersuasionButton from "./PersuasionButton"; // Senin yaptığın alkış butonu

// --- TEKİL YORUM KARTI (Uzun metinleri gizleme özelliği ile) ---
const CommentItem = ({ comment, debateId, userVote, userId }: { comment: Comment, debateId: string, userVote: any, userId: string }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    
    // Metin uzunluk kontrolü (Basit bir karakter limiti kontrolü)
    const isLongText = comment.content.length > 200;

    return (
        <div className={cn(
            "p-4 rounded-xl border bg-white transition-all hover:shadow-sm",
            // Tarafına göre sol kenar rengi (Senin istediğin 3. özellik)
            comment.side === 'A' ? "border-l-4 border-l-emerald-500 border-slate-100" : "border-l-4 border-l-rose-500 border-slate-100"
        )}>
            {/* Üst Kısım: Profil ve İsim */}
	            <div className="flex items-start justify-between mb-2">
	                <div className="flex items-center gap-2">
	                    <Avatar className="w-8 h-8 border">
	                        <AvatarImage src={comment.profiles?.avatar_url || undefined} />
	                        <AvatarFallback>{comment.profiles?.full_name?.substring(0, 2) || '??'}</AvatarFallback>
	                    </Avatar>
	                    <div>
	                        <p className="text-xs font-bold text-slate-800">{comment.profiles?.full_name || 'Anonim'}</p>
	                        <p className="text-[10px] text-slate-500">{comment.profiles?.job_title || 'Üye'}</p>
	                    </div>
	                </div>
                {/* Alkış Butonu */}
	                <PersuasionButton 
	                    debateId={debateId}
	                    commentId={comment.id}
	                    authorId={comment.profiles?.id || comment.user_id}
	                    initialCount={comment.persuasion_count}
	                    userSide={userVote}
	                    commentSide={comment.side}
	                />
            </div>

            {/* İçerik (Akordeon Mantığı) */}
            <div className="relative">
                <p className={cn(
                    "text-sm text-slate-700 leading-relaxed",
                    !isExpanded && isLongText && "line-clamp-3" // Genişletilmemişse 3 satırda kes
                )}>
                    {comment.content}
                </p>
                
                {/* Devamını Oku Butonu */}
                {!isExpanded && isLongText && (
                    <button 
                        onClick={() => setIsExpanded(true)}
                        className="text-[11px] font-bold text-slate-400 hover:text-slate-600 mt-1"
                    >
                        ...devamını oku
                    </button>
                )}
            </div>
        </div>
    );
};


// --- ANA LİSTE BİLEŞENİ (Pagination / Load More) ---
export default function DebateCommentList({ 
    comments, 
    debateId, 
    userVote,
    userId
}: { 
    comments: Comment[], 
    debateId: string, 
    userVote: 'A' | 'B' | null,
    userId: string
}) {
    // Başlangıçta kaç yorum gösterilecek?
    const INITIAL_COUNT = 3;
    const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);

    const visibleComments = comments.slice(0, visibleCount);
    const hasMore = comments.length > visibleCount;
    const remainingCount = comments.length - visibleCount;

    const handleLoadMore = () => {
        // Her basışta 5 yorum daha yükle
        setVisibleCount(prev => prev + 5);
    };

    return (
        <div className="space-y-4">
            {/* Yorumlar Listesi */}
            <div className="space-y-3">
                {visibleComments.map((comment) => (
                    <CommentItem 
                        key={comment.id} 
                        comment={comment} 
                        debateId={debateId} 
                        userVote={userVote} 
                        userId={userId}
                    />
                ))}
            </div>

            {/* "Daha Fazla Göster" Butonu ve Gradient Efekti */}
            {hasMore && (
                <div className="relative pt-8 -mt-6 z-10">
                    {/* Gradient Fade-Out Efekti (Listenin altını silikleştirir) */}
                    <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-transparent to-slate-50 pointer-events-none" />
                    
                    <Button 
                        variant="outline" 
                        onClick={handleLoadMore}
                        className="w-full bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
                    >
                        <ChevronDown className="w-4 h-4 mr-2" />
                        Diğer Yorumları Gör ({remainingCount}+)
                    </Button>
                </div>
            )}
            
            {/* Yorum yoksa */}
            {comments.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm bg-slate-50 rounded-xl border border-dashed">
                    Henüz yorum yapılmamış. İlk yorumu sen yap!
                </div>
            )}
        </div>
    );
}
