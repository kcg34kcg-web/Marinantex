'use client';

import { Smile, BookOpen, Lock } from 'lucide-react';

interface ProfileTabsProps {
  activeTab: 'social' | 'academic';
  setActiveTab: (tab: 'social' | 'academic') => void;
  isStrictAcademic: boolean;
  isSocialLocked?: boolean;
  isAcademicLocked?: boolean;
}

export default function ProfileTabs({ 
  activeTab, 
  setActiveTab, 
  isStrictAcademic, 
  isSocialLocked, 
  isAcademicLocked 
}: ProfileTabsProps) {
  return (
    <div className="flex border-b border-slate-200 mb-8 px-4">
      
      {/* SOSYAL BUTON: Eğer Strict Mode (Akademik Görünüm) ise GİZLE */}
      {!isStrictAcademic && (
        <button
          onClick={() => setActiveTab('social')}
          className={`flex-1 pb-4 text-sm font-bold flex items-center justify-center gap-2 transition-all relative ${
            activeTab === 'social' ? 'text-purple-600' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Smile size={20} className={activeTab === 'social' ? 'fill-purple-100' : ''} />
          Müzakereler
          {isSocialLocked && <Lock size={14} className="text-slate-400 opacity-50" />}
          {activeTab === 'social' && (
             <div className="absolute bottom-0 w-full h-1 bg-purple-600 rounded-t-full shadow-[0_-2px_10px_rgba(147,51,234,0.5)]" />
          )}
        </button>
      )}

      {/* AKADEMİK BUTON */}
      <button
        onClick={() => setActiveTab('academic')}
        className={`flex-1 pb-4 text-sm font-bold flex items-center justify-center gap-2 transition-all relative ${
          activeTab === 'academic' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <BookOpen size={20} className={activeTab === 'academic' ? 'fill-blue-100' : ''} />
        Kürsü Geçmişi
        {isAcademicLocked && <Lock size={14} className="text-slate-400 opacity-50" />}
        {activeTab === 'academic' && (
          <div className="absolute bottom-0 w-full h-1 bg-blue-600 rounded-t-full shadow-[0_-2px_10px_rgba(37,99,235,0.5)]" />
        )}
      </button>
    </div>
  );
}