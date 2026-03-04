'use client';

import { createClient } from '@/utils/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User, Mail, Phone, MapPin, GraduationCap, Save, Loader2, 
  TrendingUp, Wallet, ArrowLeft, Sun, Moon, Shield, Activity 
} from 'lucide-react';
import toast from 'react-hot-toast';

// 1. Updated Interface with Granular Privacy Fields
interface ProfileData {
  id: string;
  full_name: string | null;
  reputation: number;
  credits: number;
  phone: string | null;
  address: string | null;
  university: string | null;
  avatar_url: string | null;
  is_social_private: boolean;    // NEW
  is_academic_private: boolean;  // NEW
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState('');
   
  // 2. Updated State Initialization
  const [formData, setFormData] = useState<ProfileData>({
    id: '',
    full_name: '',
    reputation: 0,
    credits: 0,
    phone: '',
    address: '',
    university: '',
    avatar_url: '',
    is_social_private: false,
    is_academic_private: false
  });

  const supabase = createClient();
  const router = useRouter();

  // 3. Fetch Data including new columns
  useEffect(() => {
    const getProfile = async () => {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push('/login');
          return;
        }

        setUserEmail(user.email || ''); 

        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error) console.error('Error loading profile:', error);

        if (data) {
          setFormData({
            id: user.id,
            full_name: data.full_name || '',
            reputation: data.reputation || 0,
            credits: data.credits || 0,
            phone: data.phone || '',       
            address: data.address || '',   
            university: data.university || '', 
            avatar_url: data.avatar_url || '',
            // Load existing settings or default to false (Public)
            is_social_private: data.is_social_private || false,
            is_academic_private: data.is_academic_private || false
          });

          // Sync theme on initial load
          const event = new CustomEvent('privacy-theme-change', { 
            detail: { 
              isSocialPrivate: data.is_social_private, 
              isAcademicPrivate: data.is_academic_private 
            } 
          });
          window.dispatchEvent(event);
        }
      } catch (error) {
        console.error('Unexpected error:', error);
      } finally {
        setLoading(false);
      }
    };

    getProfile();
  }, [router, supabase]);

  // 4. Granular Privacy Toggle Handler
  const handlePrivacyToggle = async (type: 'social' | 'academic') => {
    // Determine new values based on which toggle was clicked
    const newSocial = type === 'social' ? !formData.is_social_private : formData.is_social_private;
    const newAcademic = type === 'academic' ? !formData.is_academic_private : formData.is_academic_private;

    // 1. Optimistic UI Update
    setFormData(prev => ({ 
      ...prev, 
      is_social_private: newSocial, 
      is_academic_private: newAcademic 
    }));

    // 2. Trigger Global Theme Change
    const event = new CustomEvent('privacy-theme-change', { 
      detail: { 
        isSocialPrivate: newSocial, 
        isAcademicPrivate: newAcademic 
      } 
    });
    window.dispatchEvent(event);

    // 3. Persist to DB
    const updatePayload = type === 'social' 
      ? { is_social_private: newSocial }
      : { is_academic_private: newAcademic };

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', formData.id);

    if (error) {
      toast.error('Ayarlar kaydedilemedi');
      // Revert logic could go here
    } else {
      toast.success('Gizlilik ayarı güncellendi');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: formData.full_name,
        phone: formData.phone,
        address: formData.address,
        university: formData.university,
        updated_at: new Date().toISOString(),
      })
      .eq('id', formData.id);

    if (error) {
      toast.error('Profil güncellenemedi!');
    } else {
      toast.success('Profil başarıyla güncellendi! ✅');
    }
    setSaving(false);
  };

  // Helper to determine current Moon Phase for UI text
  const getPhaseInfo = () => {
    if (formData.is_social_private && formData.is_academic_private) {
      return { icon: Moon, color: 'text-slate-400', title: 'Dolunay Modu (Tam Gizli)', desc: 'Tüm içerikleriniz sadece takipçilerinize görünür.' };
    }
    if (!formData.is_social_private && !formData.is_academic_private) {
      return { icon: Sun, color: 'text-amber-500', title: 'Güneş Modu (Tam Açık)', desc: 'Tüm içerikleriniz herkese açıktır.' };
    }
    return { icon: Shield, color: 'text-indigo-400', title: 'Yarım Ay Modu (Karma)', desc: 'Bazı içerikleriniz gizli, bazıları herkese açık.' };
  };

  const PhaseIcon = getPhaseInfo().icon;

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <Loader2 className="animate-spin text-[var(--accent)] w-10 h-10" />
      </div>
    );
  }

  return (
    // Used CSS Variables for Dynamic Theming
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 md:p-8 transition-colors duration-500">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <button 
          onClick={() => router.back()} 
          className="flex items-center gap-2 opacity-60 hover:opacity-100 hover:text-[var(--accent)] transition-all mb-4 group"
        >
          <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
          <span>Geri Dön</span>
        </button>

        {/* --- PRIVACY CONTROL CENTER --- */}
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 shadow-xl relative overflow-hidden">
           {/* Background Decoration */}
           <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--accent)] opacity-5 rounded-bl-full pointer-events-none" />
           
           <div className="flex flex-col md:flex-row gap-8 items-start md:items-center">
              {/* Left: Phase Indicator */}
              <div className="flex items-center gap-4 min-w-[280px]">
                 <div className={`w-16 h-16 rounded-full bg-[var(--muted-bg)] flex items-center justify-center ${getPhaseInfo().color}`}>
                    <PhaseIcon size={32} />
                 </div>
                 <div>
                    <h2 className="text-lg font-bold">{getPhaseInfo().title}</h2>
                    <p className="text-xs opacity-60 leading-tight mt-1">{getPhaseInfo().desc}</p>
                 </div>
              </div>

              {/* Right: Toggles */}
              <div className="flex-1 w-full grid gap-3">
                 
                 {/* Social Toggle */}
                 <div className="flex items-center justify-between bg-[var(--muted-bg)] p-3 rounded-xl border border-[var(--card-border)]/50">
                    <div className="flex items-center gap-3">
                       <div className="p-2 bg-[var(--background)] rounded-lg text-pink-500">
                          <Activity size={18} />
                       </div>
                       <div>
                          <p className="font-medium text-sm">Lexwoo (Sosyal) Gizliliği</p>
                          <p className="text-[10px] opacity-60">Gönderiler ve yorumlar</p>
                       </div>
                    </div>
                    <button
                       onClick={() => handlePrivacyToggle('social')}
                       className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${formData.is_social_private ? 'bg-slate-600' : 'bg-amber-500'}`}
                    >
                       <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-md ${formData.is_social_private ? 'left-7' : 'left-1'}`} />
                    </button>
                 </div>

                 {/* Academic Toggle */}
                 <div className="flex items-center justify-between bg-[var(--muted-bg)] p-3 rounded-xl border border-[var(--card-border)]/50">
                    <div className="flex items-center gap-3">
                       <div className="p-2 bg-[var(--background)] rounded-lg text-blue-500">
                          <GraduationCap size={18} />
                       </div>
                       <div>
                          <p className="font-medium text-sm">Akademik Geçmiş Gizliliği</p>
                          <p className="text-[10px] opacity-60">Soru-Cevap ve yapay zeka</p>
                       </div>
                    </div>
                    <button
                       onClick={() => handlePrivacyToggle('academic')}
                       className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${formData.is_academic_private ? 'bg-slate-600' : 'bg-amber-500'}`}
                    >
                       <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-md ${formData.is_academic_private ? 'left-7' : 'left-1'}`} />
                    </button>
                 </div>

              </div>
           </div>
        </div>

        {/* --- EXISTING PROFILE HEADER (Preserved) --- */}
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 flex items-center gap-6 shadow-xl transition-colors duration-300">
            <div className="w-20 h-20 bg-[var(--muted-bg)] rounded-full flex items-center justify-center text-[var(--accent)] font-bold text-3xl border-2 border-[var(--accent)]">
              {(formData.full_name?.[0] || userEmail[0] || 'U').toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{formData.full_name || 'Kullanıcı'}</h1>
              <p className="opacity-60 text-sm flex items-center gap-2">
                <Mail size={14} /> {userEmail}
              </p>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="flex gap-4">
            <div className="bg-gradient-to-br from-amber-600 to-amber-800 rounded-2xl p-6 min-w-[160px] text-white shadow-lg flex flex-col justify-between">
               <div className="flex items-center gap-2 text-amber-100 text-sm font-bold uppercase tracking-wider">
                  <Wallet size={16} /> Kredi
               </div>
               <div className="text-4xl font-bold">{formData.credits} 🪙</div>
            </div>

            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 min-w-[160px] shadow-lg flex flex-col justify-between transition-colors duration-300">
               <div className="flex items-center gap-2 opacity-60 text-sm font-bold uppercase tracking-wider">
                  <TrendingUp size={16} /> Puan
               </div>
               <div className="text-4xl font-bold text-[var(--accent)]">{formData.reputation}</div>
            </div>
          </div>
        </div>

        {/* --- EDIT FORM (Preserved) --- */}
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-8 shadow-xl transition-colors duration-300">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <User className="text-[var(--accent)]" />
            Kişisel Bilgiler
          </h2>

          <form onSubmit={handleUpdate} className="grid md:grid-cols-2 gap-6">
            
            <div className="space-y-2">
              <label className="text-sm font-medium opacity-70">Ad Soyad</label>
              <div className="relative">
                <User className="absolute left-3 top-3 opacity-50" size={18} />
                <input
                  type="text"
                  value={formData.full_name || ''}
                  onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                  className="w-full bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-lg py-2.5 pl-10 pr-4 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none transition-all"
                  placeholder="Adınız Soyadınız"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium opacity-70">Üniversite / Unvan</label>
              <div className="relative">
                <GraduationCap className="absolute left-3 top-3 opacity-50" size={18} />
                <input
                  type="text"
                  value={formData.university || ''}
                  onChange={(e) => setFormData({...formData, university: e.target.value})}
                  className="w-full bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-lg py-2.5 pl-10 pr-4 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none transition-all"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium opacity-70">Telefon Numarası</label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 opacity-50" size={18} />
                <input
                  type="tel"
                  value={formData.phone || ''}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  className="w-full bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-lg py-2.5 pl-10 pr-4 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none transition-all"
                />
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium opacity-70">Adres</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 opacity-50" size={18} />
                <textarea
                  rows={3}
                  value={formData.address || ''}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  className="w-full bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-lg py-2.5 pl-10 pr-4 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none transition-all resize-none"
                />
              </div>
            </div>

            <div className="md:col-span-2 flex justify-end pt-4">
              <button
                type="submit"
                disabled={saving}
                className="bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-xl font-medium transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Kaydediliyor...
                  </>
                ) : (
                  <>
                    <Save size={20} />
                    Değişiklikleri Kaydet
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}