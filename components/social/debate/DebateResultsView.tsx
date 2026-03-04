'use client';

import { CheckCircle2, XCircle, Send, Lock } from "lucide-react";
import { useState } from "react";
import type { Debate, DebateComment } from "@/app/types";
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';

interface DebateResultsViewProps {
    debate: Debate;
    userVote: 'A' | 'B' | null;
    commentsA: DebateComment[];
    commentsB: DebateComment[];
    handleSendComment: (side: 'A' | 'B', text: string) => void;
    handleVote: (choice: 'A' | 'B') => void;
    commentText: string;
    setCommentText: (t: string) => void;
    sending: boolean;
    voting: boolean;
}

export default function DebateResultsView({ 
    debate, userVote, commentsA, commentsB, handleSendComment, handleVote 
}: DebateResultsViewProps) {
    
    // Basit yerel state (Bu component genellikle üstten yönetilir ama text input burada da olabilir)
    const [localText, setLocalText] = useState("");

    const percentA = debate.stats.total > 0 
        ? Math.round((debate.stats.a / debate.stats.total) * 100) 
        : 50;
    
    const isWinnerA = percentA >= 50;

    return (
        <div className="space-y-8">
            {/* 1. İstatistik Barı */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex justify-between mb-2 text-sm font-bold">
                    <span className="text-emerald-600">% {percentA} - A Seçeneği</span>
                    <span className="text-rose-600">B Seçeneği - % {100 - percentA}</span>
                </div>
                <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden flex relative shadow-inner">
                    <div style={{ width: `${percentA}%` }} className="bg-emerald-500 h-full transition-all duration-700 relative">
                        {isWinnerA && <div className="absolute inset-0 bg-white/20 animate-pulse"></div>}
                    </div>
                    <div style={{ width: `${100 - percentA}%` }} className="bg-rose-500 h-full transition-all duration-700"></div>
                </div>
                <p className="text-center text-xs text-slate-400 mt-2 font-medium">Toplam {debate.stats.total} oy kullanıldı</p>
            </div>

            {/* 2. Yorumlar ve Tartışma Alanı */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* SOL Taraf (A) */}
                <div className={`space-y-4 ${userVote === 'A' ? 'opacity-100' : 'opacity-60 blur-[1px] hover:blur-0 hover:opacity-100 transition-all'}`}>
                    <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                         <h3 className="font-bold text-emerald-800 flex items-center gap-2">
                            <CheckCircle2 size={18} /> A Tarafı Savunması
                         </h3>
                         {userVote !== 'A' && (
                             <button onClick={() => handleVote('A')} className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded border border-emerald-200 hover:bg-emerald-100 font-bold">
                                 Bu tarafa geç
                             </button>
                         )}
                    </div>
                    
                    {/* Yorum Listesi */}
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {commentsA.length === 0 && <p className="text-sm text-slate-400 italic">Henüz yorum yok. İlk sen ol!</p>}
                        {commentsA.map(c => (
                            <div key={c.id} className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-50 text-sm">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-emerald-900 text-xs">{c.profiles?.full_name}</span>
                                    <span className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(c.created_at), { locale: tr })}</span>
                                </div>
                                <p className="text-slate-700 leading-relaxed">{c.content}</p>
                            </div>
                        ))}
                    </div>

                    {/* Yorum Yazma (Sadece kendi tarafına) */}
                    {userVote === 'A' && (
                        <div className="flex gap-2 pt-2">
                            <input 
                                value={localText}
                                onChange={(e) => setLocalText(e.target.value)}
                                onKeyDown={(e) => {
                                    if(e.key === 'Enter' && localText.trim()) {
                                        handleSendComment('A', localText);
                                        setLocalText("");
                                    }
                                }}
                                placeholder="A tarafını savun..."
                                className="flex-1 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                            <button 
                                onClick={() => {
                                    if(localText.trim()) {
                                        handleSendComment('A', localText);
                                        setLocalText("");
                                    }
                                }}
                                className="bg-emerald-600 text-white p-2 rounded-lg hover:bg-emerald-700"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    )}
                </div>

                {/* SAĞ Taraf (B) */}
                <div className={`space-y-4 ${userVote === 'B' ? 'opacity-100' : 'opacity-60 blur-[1px] hover:blur-0 hover:opacity-100 transition-all'}`}>
                    <div className="flex items-center justify-between border-b border-rose-100 pb-2">
                         <h3 className="font-bold text-rose-800 flex items-center gap-2">
                            <XCircle size={18} /> B Tarafı Savunması
                         </h3>
                         {userVote !== 'B' && (
                             <button onClick={() => handleVote('B')} className="text-xs bg-rose-50 text-rose-600 px-2 py-1 rounded border border-rose-200 hover:bg-rose-100 font-bold">
                                 Bu tarafa geç
                             </button>
                         )}
                    </div>

                     <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {commentsB.length === 0 && <p className="text-sm text-slate-400 italic">Henüz yorum yok. İlk sen ol!</p>}
                        {commentsB.map(c => (
                            <div key={c.id} className="bg-rose-50/50 p-3 rounded-xl border border-rose-50 text-sm">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-rose-900 text-xs">{c.profiles?.full_name}</span>
                                    <span className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(c.created_at), { locale: tr })}</span>
                                </div>
                                <p className="text-slate-700 leading-relaxed">{c.content}</p>
                            </div>
                        ))}
                    </div>

                    {userVote === 'B' && (
                         <div className="flex gap-2 pt-2">
                            <input 
                                value={localText}
                                onChange={(e) => setLocalText(e.target.value)}
                                onKeyDown={(e) => {
                                    if(e.key === 'Enter' && localText.trim()) {
                                        handleSendComment('B', localText);
                                        setLocalText("");
                                    }
                                }}
                                placeholder="B tarafını savun..."
                                className="flex-1 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 focus:ring-rose-500 focus:border-rose-500"
                            />
                            <button 
                                onClick={() => {
                                    if(localText.trim()) {
                                        handleSendComment('B', localText);
                                        setLocalText("");
                                    }
                                }}
                                className="bg-rose-600 text-white p-2 rounded-lg hover:bg-rose-700"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    )}
                </div>

            </div>
            
            {!userVote && (
                <div className="text-center p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <Lock className="mx-auto text-slate-400 mb-2" size={24} />
                    <p className="text-slate-500 font-medium">Yorumları okumak ve yazmak için önce oy kullanmalısın.</p>
                </div>
            )}
        </div>
    );
}