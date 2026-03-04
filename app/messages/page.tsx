import { createClient } from '@/utils/supabase/server';
import { getUserConversations } from '@/app/actions/chat';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';

export default async function InboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return <div>Giriş yapmalısınız.</div>;

  const conversations = await getUserConversations();

  return (
    <div className="max-w-2xl mx-auto p-4 min-h-screen text-slate-100">
      <h1 className="text-2xl font-bold mb-6 border-b border-slate-800 pb-2">Mesajlar</h1>
      
      {conversations.length === 0 ? (
        <div className="text-center text-slate-500 py-10">
          Henüz hiç mesajınız yok.
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv: any) => {
            // Basit okunmamış mesaj kontrolü
            const isUnread = new Date(conv.updated_at) > new Date(conv.last_read_at);

            return (
              <Link 
                key={conv.id} 
                href={`/messages/${conv.id}`}
                className={`block p-4 rounded-xl transition-colors border ${
                  isUnread 
                    ? 'bg-slate-800 border-blue-900/50' 
                    : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-blue-400">
                    {/* Burada gerçek kullanıcı adını çekmek için bir profil bileşeni kullanılabilir */}
                    Kullanıcı {conv.otherUserId?.slice(0, 5)}...
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true, locale: tr })}
                  </span>
                </div>
                
                <p className={`text-sm truncate ${isUnread ? 'text-slate-100 font-medium' : 'text-slate-400'}`}>
                  {conv.last_message || 'Yeni konuşma'}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}