'use client';

import { BookOpen, Lock } from 'lucide-react';
import type { ExtendedProfile } from '@/app/types';

interface AcademicTabContentProps {
  profile: ExtendedProfile;
  isLocked: boolean;
}

export default function AcademicTabContent({ profile, isLocked }: AcademicTabContentProps) {
  if (isLocked) {
    return (
      <div className="flex h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center">
        <Lock className="mb-3 h-8 w-8 text-slate-400" />
        <h3 className="text-lg font-bold text-slate-800">Akademik içerik gizli</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Bu kullanıcı akademik geçmişini yalnızca takipçileriyle paylaşıyor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Akademik Profil Özeti</h3>
        </div>
        <p className="text-sm text-slate-600">
          {profile.university?.trim()
            ? `${profile.university} alanında içerik üretiyor.`
            : 'Henüz akademik özet eklenmemiş.'}
        </p>
      </div>
    </div>
  );
}

