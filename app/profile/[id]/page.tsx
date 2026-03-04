'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import ChatDialog from '@/components/chat/ChatDialog';
import ProfileHeader from '@/components/profile/ProfileHeader';
import ProfileTabs from '@/components/profile/ProfileTabs';
import SocialTabContent from '@/components/profile/SocialTabContent';
import AcademicTabContent from '@/components/profile/AcademicTabContent';
import { ExtendedProfile } from '@/app/types';

export default function DynamicProfilePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const userId = params.id as string;
  const supabase = createClient();

  const isStrictAcademic = searchParams.get('view') === 'academic';

  const [profile, setProfile] = useState<ExtendedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [followStatus, setFollowStatus] = useState<'none' | 'pending' | 'accepted'>('none');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<'social' | 'academic'>(
    isStrictAcademic ? 'academic' : 'social'
  );

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileData) setProfile(profileData as ExtendedProfile);

      if (user && user.id !== userId) {
        const { data: followData } = await supabase
          .from('follows')
          .select('status')
          .eq('follower_id', user.id)
          .eq('following_id', userId)
          .maybeSingle();
        if (followData) setFollowStatus(followData.status as 'pending' | 'accepted');
      }
      setLoading(false);
    };
    fetchData();
  }, [userId, supabase]);

  const handleFollow = async () => {
    if (!currentUserId) return;
    if (followStatus === 'none') {
      const requiresApproval = profile?.is_social_private || profile?.is_academic_private;
      const targetStatus = requiresApproval ? 'pending' : 'accepted';
      const { error } = await supabase.from('follows').insert({ 
        follower_id: currentUserId, 
        following_id: userId, 
        status: targetStatus 
      });
      if (!error) setFollowStatus(targetStatus);
    } else {
      const { error } = await supabase.from('follows').delete().eq('follower_id', currentUserId).eq('following_id', userId);
      if (!error) setFollowStatus('none');
    }
  };

  // Loading: Temiz ve basit
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-orange-500"></div>
        <span className="text-sm font-medium text-slate-500">Yükleniyor...</span>
      </div>
    </div>
  );

  if (!profile) return <div className="p-10 text-center text-slate-600">Kullanıcı bulunamadı.</div>;

  const isOwner = currentUserId === userId;
  const isFollowing = followStatus === 'accepted';
  const isSocialLocked = profile.is_social_private && !isOwner && !isFollowing;
  const isAcademicLocked = profile.is_academic_private && !isOwner && !isFollowing;

  return (
    // ZEMİN: Gözü yormayan çok açık gri (Slate-50)
    <div className="min-h-screen bg-slate-50">
      
      {/* ÜST BANNER: Kurumsal Lacivert (#0f172a) */}
      {/* Gözü yormaz, başlık alanını ayırır */}
      <div className="h-48 w-full bg-[#0f172a]" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        
        {/* PROFİL KARTI - Banner'ın üstüne biniyor (-mt-20) */}
        <div className="relative -mt-20 flex flex-col gap-6">
          
          {/* HEADER & TABS BİR ARADA: Bütünleşik Beyaz Kart */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            
            {/* 1. Header Kısmı */}
            <div className="p-6 md:p-8">
              <ProfileHeader 
                profile={profile}
                isOwner={isOwner}
                followStatus={followStatus}
                onFollow={handleFollow}
                onMessage={() => setIsChatOpen(true)}
              />
            </div>

            {/* 2. Sekmeler Kısmı: Header'ın hemen altında, çizgili ayrım */}
            <div className="border-t border-slate-100 bg-slate-50/50 px-6 md:px-8">
              <ProfileTabs 
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                isStrictAcademic={isStrictAcademic}
                isSocialLocked={isSocialLocked}
                isAcademicLocked={isAcademicLocked}
              />
            </div>
          </div>

          {/* 3. İÇERİK ALANI: Ayrı bir beyaz kart, temiz okuma deneyimi */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[400px] p-6 md:p-8">
            
            {!isStrictAcademic && activeTab === 'social' && (
               <div className="animate-in fade-in duration-300">
                  <SocialTabContent 
                    userId={userId} 
                    isLocked={isSocialLocked} 
                  />
               </div>
            )}

            {activeTab === 'academic' && (
               <div className="animate-in fade-in duration-300">
                  <AcademicTabContent 
                    profile={profile} 
                    isLocked={isAcademicLocked} 
                  />
               </div>
            )}
          </div>
        </div>

      </div>

      <ChatDialog 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)}
        recipientId={userId}
        recipientName={profile.full_name || 'Kullanıcı'}
        recipientAvatar={profile.avatar_url || undefined}
        currentUser={{ id: currentUserId }}
      />
    </div>
  );
}