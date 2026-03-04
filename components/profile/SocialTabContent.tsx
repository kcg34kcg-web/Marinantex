'use client';

import { Lock, MessageSquare } from 'lucide-react';
import PostList from '@/components/PostList';

interface SocialTabContentProps {
  userId: string;
  isLocked: boolean | undefined;
}

export default function SocialTabContent({ userId, isLocked }: SocialTabContentProps) {
  // DURUM 1: KİLİTLİ GÖRÜNÜM
  if (isLocked) {
    return (
      <div className="bg-slate-50/50 rounded-[2rem] p-12 text-center border border-slate-200/60 shadow-inner flex flex-col items-center justify-center h-80">
        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 text-slate-300 shadow-sm border border-slate-100">
          <Lock size={36} />
        </div>
        <h3 className="text-xl font-black text-slate-800">İçerikler Gizli 🔒</h3>
        <p className="text-slate-500 max-w-xs mx-auto mt-2 font-medium">
          Bu kullanıcının paylaşımlarını görmek için takip isteği göndermelisin.
        </p>
      </div>
    );
  }

  // DURUM 2: AÇIK GÖRÜNÜM (Post Listesi)
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <PostList userId={userId} />
    </div>
  );
}