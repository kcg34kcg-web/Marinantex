"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/utils/supabase/client";
import { Bird, Hourglass } from "lucide-react"; // Added Hourglass icon
import toast from "react-hot-toast";

// Imports
import CommentItem from "./CommentItem"; 
import { FlatComment } from "@/app/types"; 
import { buildCommentTree } from "@/utils/commentTree"; 

interface CommentSectionProps {
  postId: string;
  postOwnerId: string;
}

export default function CommentSection({ postId, postOwnerId }: CommentSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  
  // State
  const [flatComments, setFlatComments] = useState<FlatComment[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserData, setCurrentUserData] = useState<any>(null);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 1. Init Data & User
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);
      setCurrentUserData(user || null);

      const { data, error } = await supabase
        .from("comments_with_stats")
        .select("*")
        .eq("post_id", postId)
        .order('created_at', { ascending: true }) 
        .limit(2000); 

      if (error) {
        console.error("Yorumlar çekilemedi:", error);
        return;
      }

      setFlatComments(data as FlatComment[]);
    };

    init();

    const channel = supabase.channel(`comments_section:${postId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, init)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comment_reactions' }, init)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [postId, supabase]);

  // 2. Build Tree
  const commentTree = useMemo(() => {
    return buildCommentTree(flatComments);
  }, [flatComments]);

  // 3. Main Submit
  const handleMainSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !currentUserId) return;
    if (currentUserId === postOwnerId) return toast.error("Kendi gönderinize müzakere başlatamazsınız.");

    const tempId = crypto.randomUUID();
    
    const tempComment: FlatComment = {
      id: tempId,
      post_id: postId,
      parent_id: null,
      content: input,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      author_name: currentUserData?.user_metadata?.full_name || "Ben",
      author_avatar: currentUserData?.user_metadata?.avatar_url || "",
      woow_count: 0, doow_count: 0, adil_count: 0, reply_count: 0,
      my_reaction: null,
      score: 0
    };

    setFlatComments(prev => [tempComment, ...prev]);
    setInput("");
    setSubmitting(true);

    const { error } = await supabase.from("comments").insert({
      post_id: postId,
      user_id: currentUserId,
      content: tempComment.content,
      parent_id: null
    });

    setSubmitting(false);
    
    if (error) {
      toast.error("Hata oluştu, yorum geri alınıyor.");
      setFlatComments(prev => prev.filter(c => c.id !== tempId)); 
    }
  };

  // 4. Reply Submit
  const handleReplySubmit = async (parentId: string, content: string) => {
    if (!currentUserId) return;
    const tempId = crypto.randomUUID();
    
    const tempComment: FlatComment = {
      id: tempId,
      post_id: postId,
      parent_id: parentId,
      content: content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      author_name: currentUserData?.user_metadata?.full_name || "Ben",
      author_avatar: currentUserData?.user_metadata?.avatar_url || "",
      woow_count: 0, doow_count: 0, adil_count: 0, reply_count: 0,
      my_reaction: null,
      score: 0
    };

    setFlatComments(prev => [...prev, tempComment]);

    const { error } = await supabase.from("comments").insert({
      post_id: postId,
      user_id: currentUserId,
      content: content,
      parent_id: parentId
    });

    if (error) {
      setFlatComments(prev => prev.filter(c => c.id !== tempId));
      throw error;
    }
  };

  return (
    <div className="mt-4 space-y-8">
      {/* Input Form (Hidden for Owner) */}
      {currentUserId && currentUserId !== postOwnerId && (
        <form onSubmit={handleMainSubmit} className="relative flex items-center mb-6">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Müzakereyi başlat..."
            disabled={submitting}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-5 pr-12 text-sm text-slate-700 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm"
          />
          <button 
            type="submit" 
            disabled={!input.trim() || submitting}
            className="absolute right-2 p-2 text-white bg-slate-900 rounded-xl hover:bg-black disabled:opacity-50 transition-colors shadow-md"
          >
            <Bird size={16} />
          </button>
        </form>
      )}

      {/* Comment List */}
      <div className="space-y-4">
        {commentTree.map((rootNode) => (
          <CommentItem 
            key={rootNode.id} 
            node={rootNode}
            currentUserId={currentUserId}
            onReply={handleReplySubmit}
            depth={0} 
          />
        ))}

        {/* PHASE 1: SMART EMPTY STATE LOGIC */}
        {commentTree.length === 0 && (
           <div className="flex flex-col items-center justify-center py-8 text-slate-400">
             {currentUserId === postOwnerId ? (
               // Case A: Post Owner
               <>
                 <Hourglass size={32} className="mb-2 opacity-30 text-amber-500" />
                 <p className="text-sm font-medium text-slate-500">Bu senin gönderin.</p>
                 <p className="text-xs text-slate-400 mt-1">Diğer kullanıcıların müzakere başlatmasını bekle.</p>
               </>
             ) : (
               // Case B: Visitor
               <>
                 <Bird size={32} className="mb-2 opacity-20" />
                 <p className="text-sm">Henüz ses yok. İlk sen ol.</p>
               </>
             )}
           </div>
        )}
      </div>
    </div>
  );
}
