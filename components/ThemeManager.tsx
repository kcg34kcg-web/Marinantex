// components/ThemeManager.tsx
'use client';

import { useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function ThemeManager() {
  const supabase = createClient();

  useEffect(() => {
    // 1. Core Logic: Decides the Theme based on the two toggles
    const applyTheme = (socialPrivate: boolean, academicPrivate: boolean) => {
      const root = document.documentElement;

      // 🌕 Full Moon (Both Private) -> Default Dark Mode (Remove attribute)
      if (socialPrivate && academicPrivate) {
        root.removeAttribute('data-theme');
        return;
      }

      // ☀️ Sun Mode (Both Public) -> Warm/Amber Theme
      if (!socialPrivate && !academicPrivate) {
        root.setAttribute('data-theme', 'sun');
        return;
      }

      // 🌓 Half Moon (Mixed) -> Twilight/Neutral Theme
      root.setAttribute('data-theme', 'half');
    };

    // 2. Fetch Settings from Database on Load
    const syncTheme = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('profiles')
        .select('is_social_private, is_academic_private')
        .eq('id', user.id)
        .single();

      if (data) {
        applyTheme(data.is_social_private || false, data.is_academic_private || false);
      }
    };

    syncTheme();

    // 3. Listen for Instant Changes (from the Profile Page)
    const handleLocalChange = (e: CustomEvent) => {
      applyTheme(e.detail.isSocialPrivate, e.detail.isAcademicPrivate);
    };

    window.addEventListener('privacy-theme-change' as any, handleLocalChange as any);

    return () => {
      window.removeEventListener('privacy-theme-change' as any, handleLocalChange as any);
    };
  }, [supabase]);

  return null; // Invisible component
}