'use client';

import { User, Lock, UserPlus, Check, MessageCircle, Sparkles } from 'lucide-react';
import { ExtendedProfile } from '@/app/types'; 

// ✅ DÜZELTME BURADA: isLocked eklendi
interface ProfileHeaderProps {
  profile: ExtendedProfile;
  isOwner: boolean;
  followStatus: string;
  isLocked?: boolean; // <--- ARTIK BU PROP'U TANIYOR
  onFollow: () => void;
  onMessage: () => void;
}

export default function ProfileHeader({ 
  profile, 
  isOwner, 
  followStatus, 
  isLocked, // <--- Destructuring (Parçalarına ayırma) işlemine eklendi
  onFollow, 
  onMessage 
}: ProfileHeaderProps) {

  // Kilit durumu dışarıdan (isLocked) gelebilir veya içeride hesaplanabilir.
  // Eğer parent'tan isLocked gelirse onu kullan, gelmezse hesapla.
  const isFullyPrivate = isLocked !== undefined 
    ? isLocked 
    : (profile.is_social_private && profile.is_academic_private);

  const isAnyLocked = profile.is_social_private || profile.is_academic_private;

  return (
    <div className="bg-white rounded-[2rem] p-6 md:p-8 shadow-xl shadow-slate-200/60 border border-slate-100 mb-8 relative overflow-hidden group">
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-r from-violet-100 via-fuchsia-50 to-amber-50 -z-0"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row items-center md:items-end gap-6 mt-8">
          {/* Avatar */}
          <div className="w-28 h-28 md:w-36 md:h-36 rounded-full bg-white p-1.5 shadow-2xl flex-shrink-0 relative group-hover:scale-105 transition-transform duration-500">
            <div className="w-full h-full rounded-full bg-slate-100 overflow-hidden relative flex items-center justify-center border border-slate-100">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name || ''} className="w-full h-full object-cover" />
              ) : (
                <User className="w-12 h-12 text-slate-300" />
              )}
            </div>
            {/* Online Durumu (Opsiyonel - Yeşil nokta) */}
            {/* <div className="absolute bottom-2 right-2 w-5 h-5 bg-green-500 border-4 border-white rounded-full"></div> */}
          </div>

          {/* İsim ve Biyografi */}
          <div className="flex-1 text-center md:text-left mb-2">
            <div className="flex flex-col md:flex-row items-center gap-3 mb-2 justify-center md:justify-start">
              <h1 className="text-3xl font-black text-slate-800 tracking-tight">{profile.full_name}</h1>
              {isFullyPrivate && (
                <span title="Gizli Hesap" className="bg-slate-100 p-1.5 rounded-full">
                   <Lock size={14} className="text-slate-500" />
                </span>
              )}
            </div>
            <p className="text-slate-600 max-w-lg text-lg leading-relaxed">{profile.biography || "Henüz biyografi eklenmemiş."}</p>
          </div>

          {/* Butonlar */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-center">
            {!isOwner ? (
              <>
                <button 
                  onClick={onFollow}
                  className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm transition-all active:scale-95 shadow-lg shadow-slate-200
                    ${followStatus === 'none' 
                        ? 'bg-slate-900 text-white hover:bg-slate-800 hover:shadow-xl' 
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}`}
                >
                  {followStatus === 'none' ? <UserPlus size={18} /> : <Check size={18} />}
                  {followStatus === 'none' 
                    ? (isAnyLocked ? 'İstek Gönder' : 'Takip Et') 
                    : (followStatus === 'pending' ? 'İstek yollandı' : 'Takiptesin')}
                </button>
                
                <button 
                    onClick={onMessage}
                    className="group relative flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 overflow-hidden"
                >
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                    <MessageCircle size={20} className="group-hover:rotate-12 transition-transform" />
                    <span className="relative z-10">Mesaj Gönder</span>
                    <Sparkles size={16} className="absolute top-1 right-2 text-yellow-300 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100" />
                </button>
              </>
            ) : (
              <a href="/profile" className="px-6 py-3 rounded-full bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors shadow-sm">
                Profili Düzenle
              </a>
            )}
          </div>
        </div>
      </div>
  );
}