'use client'

import { useChatScroll } from '@/hooks/useChatScroll';
import { cn } from '@/utils/cn'; 
import Image from 'next/image';

interface MessageListProps {
  messages: any[];
  currentUserId: string;
  onLoadMore: () => void;
}

export default function MessageList({ messages, currentUserId, onLoadMore }: MessageListProps) {
    // Scroll hook'unu geri getirdik
    const scrollRef = useChatScroll(messages);
    
    // En tepeye gelince daha fazlasını yükle
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement;
        if (target.scrollTop === 0) {
            onLoadMore();
        }
    };

    return (
        <div 
            ref={scrollRef} 
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50" // Zemin rengi: Açık Gri
        >
            {/* Yükleme payı */}
            <div className="h-4" /> 

            {messages.map((msg, index) => {
                const isMe = msg.sender_id === currentUserId;
                const isDeleted = msg.deleted_at;
                
                return (
                    <div key={msg.id || index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        
                        <div 
                            className={cn(
                                // BU SATIRLAR MESAJIN YANA TAŞMASINI ENGELLER:
                                "max-w-[85%] sm:max-w-[70%] rounded-2xl px-5 py-3 relative group shadow-sm text-sm",
                                "break-words whitespace-pre-wrap leading-relaxed", 
                                
                                // RENKLER:
                                isMe 
                                    ? "bg-slate-900 text-white rounded-tr-none" // BEN: Lacivert
                                    : "bg-white text-slate-800 rounded-tl-none border border-slate-200", // KARŞI: Beyaz
                                
                                // Optimistic (Geçici) Mesaj Opaklığı
                                msg.isOptimistic && "opacity-70"
                            )}
                        >
                            {isDeleted ? (
                                <p className="italic text-sm opacity-60 flex items-center gap-2">
                                    <span>🚫</span> Mesaj silindi
                                </p>
                            ) : (
                                <>
                                    {/* Medya Gösterimi */}
                                    {msg.media_url && (
                                        <div className="mb-2 mt-1">
                                            {msg.media_type?.startsWith('image') ? (
                                                <div className="relative w-full h-48 sm:h-64 rounded-lg overflow-hidden border border-black/10">
                                                    <Image 
                                                        src={msg.signedUrl || msg.media_url} 
                                                        alt="attachment" 
                                                        fill
                                                        className="object-cover"
                                                    />
                                                </div>
                                            ) : (
                                                <a 
                                                    href={msg.signedUrl || msg.media_url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className={`flex items-center gap-2 text-sm underline p-2 rounded ${isMe ? 'bg-white/10' : 'bg-slate-100'}`}
                                                >
                                                    📎 Dosyayı Görüntüle
                                                </a>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Metin İçeriği */}
                                    {msg.content}
                                </>
                            )}

                            {/* Mesaj Bilgisi (Saat ve Tikler) */}
                            <div className={cn(
                                "text-[10px] mt-1 flex items-center justify-end gap-1 opacity-60",
                                isMe ? "text-slate-300" : "text-slate-500"
                            )}>
                                {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                                
                                {isMe && !isDeleted && (
                                    <span>
                                        {msg.isOptimistic ? '🕒' : (msg.is_read ? '✓✓' : '✓')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}