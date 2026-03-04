import { createClient } from '@/utils/supabase/server';
import { getMessages } from '@/app/actions/chat';
import ChatWindow from '@/components/chat/ChatWindow';
import { redirect } from 'next/navigation';

export default async function ChatPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: participation } = await supabase
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', params.id)
    .eq('user_id', user.id)
    .single();

  if (!participation) redirect('/messages'); 

  const initialMessages = await getMessages(params.id, 0);

  return (
    // DÜZELTME: fixed yerine relative ve h-[100dvh] kullanıyoruz.
    // Bu, mobil tarayıcılarda (Safari/Chrome) klavye açılınca yaşanan sorunları çözer.
    <div className="relative w-full h-[100dvh] bg-white overflow-hidden flex flex-col">
      <ChatWindow 
        conversationId={params.id} 
        initialMessages={initialMessages} 
        currentUser={user} 
      />
    </div>
  );
}