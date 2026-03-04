import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { NotificationPopover } from '@/components/notifications/NotificationPopover';

export default async function Navbar() {
  const supabase = await createClient();
  
  // Kullanıcı oturumunu sunucu tarafında kontrol ediyoruz
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <nav className="bg-[#1e293b] text-[#f59e0b] p-4 flex justify-between items-center relative z-50 shadow-md">
      <Link href="/">
        <p className="text-2xl font-bold tracking-tight">Babylexit</p>
      </Link>
      
      <div className="flex items-center gap-4">
        {user ? (
          <>
            {/* Kullanıcı giriş yapmışsa: Twitter Stili Bildirim Zili */}
            <NotificationPopover userId={user.id} />
            
            {/* Profil Linki */}
            <Link 
              href="/profile" 
              className="hover:text-amber-300 transition-colors font-medium text-sm lg:text-base"
            >
              Profil
            </Link>
          </>
        ) : (
          /* Kullanıcı yoksa: Giriş Linkleri */
          <div className="flex items-center gap-4 text-sm font-medium">
            <Link href="/login" className="hover:text-amber-300 transition-colors">Giriş Yap</Link>
            <Link 
                href="/signup" 
                className="bg-amber-500/10 hover:bg-amber-500/20 px-4 py-2 rounded-full transition-colors text-amber-500"
            >
                Kayıt Ol
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}