'use server'

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

const MAX_CHAR_LIMIT = 1000;

export async function startConversation(recipientId: string) {
  const supabase = await createClient();
  const { data: conversationId, error } = await supabase.rpc('get_or_create_dm', {
    recipient_id: recipientId
  });

  if (error) {
    console.error('Sohbet başlatma hatası:', error);
    throw new Error('Sohbet başlatılamadı');
  }
  return conversationId;
}

export async function sendMessage(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) throw new Error('Yetkisiz işlem');

  const conversationId = formData.get('conversationId') as string;
  const content = formData.get('content') as string;
  const file = formData.get('file') as File | null;

  if (content && content.length > MAX_CHAR_LIMIT) {
    throw new Error(`Mesaj çok uzun! Maksimum ${MAX_CHAR_LIMIT} karakter.`);
  }

  let mediaUrl = null;
  let mediaType = null;

  if (file && file.size > 0) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${conversationId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-files')
      .upload(filePath, file);

    if (uploadError) throw new Error('Dosya yüklenemedi: ' + uploadError.message);
    
    mediaUrl = filePath;
    mediaType = file.type.split('/')[0];
  }

  const { data: newMessage, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: content,
      media_url: mediaUrl,
      media_type: mediaType,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase
    .from('conversations')
    .update({ 
        updated_at: new Date().toISOString(), 
        last_message_preview: content ? content.substring(0, 50) : (mediaType ? '📎 Medya' : 'Dosya gönderildi') 
    })
    .eq('id', conversationId);

  revalidatePath(`/messages/${conversationId}`);
  return newMessage;
}

export async function markMessagesAsRead(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return;

  await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id);
}

export async function getMessages(conversationId: string, page: number = 0) {
    const supabase = await createClient();
    const pageSize = 20;
    
    const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

    if (data) {
        const signedData = await Promise.all(data.map(async (msg) => {
            if (msg.media_url && !msg.deleted_at) {
                const { data: signed } = await supabase.storage
                    .from('chat-files')
                    .createSignedUrl(msg.media_url, 3600);
                return { ...msg, signedUrl: signed?.signedUrl };
            }
            return msg;
        }));
        return signedData.reverse(); 
    }
    return [];
}

/**
 * ✅ OPTİMİZE EDİLMİŞ LİSTELEME
 * Paralel sorgular (Promise.all) kullanır, daha hızlıdır.
 */
export async function getUserConversations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return [];

  // 1. Önce benim sohbet ID'lerimi çek (Burası mecbur sıralı)
  const { data: myConvos } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id);

  if (!myConvos || myConvos.length === 0) return [];

  const conversationIds = myConvos.map(c => c.conversation_id);

  // 2. 🚀 OPTİMİZASYON: Detayları ve Katılımcıları AYNI ANDA çek
  const [detailsResult, participantsResult] = await Promise.all([
    // Sohbet detaylarını çek
    supabase
      .from('conversations')
      .select('id, updated_at, last_message_preview')
      .in('id', conversationIds),
    
    // Diğer katılımcıları çek
    supabase
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', conversationIds)
      .neq('user_id', user.id) // Kendimiz hariç
  ]);

  const conversationDetails = detailsResult.data;
  const otherParticipants = participantsResult.data;

  // 3. Profilleri çek (Katılımcı verisine bağlı olduğu için burası beklemek zorunda)
  const otherUserIds = otherParticipants?.map(p => p.user_id) || [];
  
  if (otherUserIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', otherUserIds);

  // 4. Verileri Birleştir
  const result = myConvos.map(myConvo => {
    const details = conversationDetails?.find(d => d.id === myConvo.conversation_id);
    const otherPart = otherParticipants?.find(op => op.conversation_id === myConvo.conversation_id);
    const profile = profiles?.find(p => p.id === otherPart?.user_id);

    if (!profile) return null;

    return {
      id: myConvo.conversation_id,
      updated_at: details?.updated_at,
      last_message: details?.last_message_preview,
      last_read_at: myConvo.last_read_at,
      otherUserId: profile.id,
      userInfo: {
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        username: profile.username
      }
    };
  }).filter(Boolean);

  // Sıralama
  return result.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export async function searchUsers(query: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !query || query.length < 2) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .or(`username.ilike.%${query}%,full_name.ilike.%${query}%`)
    .neq('id', user.id) 
    .limit(10);

  if (error) {
    console.error('Kullanıcı arama hatası:', error);
    return [];
  }

  return data || [];
}