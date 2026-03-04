"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/utils/supabase/client";
import { Send, MessageCircle } from "lucide-react";
import toast from "react-hot-toast";
import MuzakereItem from "./MuzakereItem";
import { cn } from "@/utils/cn"; // Assuming you have a cn utility, or remove if not

type CommentWithReactions = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  user?: { full_name: string; avatar_url: string }; // Adjust based on your profile fetch
  reactions: { reaction_type: string; user_id: string }[];
  woow_count: number;
  doow_count: number;
  adil_count: number;
  my_reaction: "woow" | "doow" | "adil" | null;
};

interface MuzakereSectionProps {
  postId: string;
  postOwnerId: string;
  currentUser: any;
  isOpen: boolean; // Controlled by parent
}

export default function MuzakereSection({ 
  postId, 
  postOwnerId, 
  currentUser,
  isOpen 
}: MuzakereSectionProps) {
  const supabase = createClient();
  const [comments, setComments] = useState<CommentWithReactions[]>([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isFetched, setIsFetched] = useState(false);

  // 1. Fetch Comments & Reactions Efficiently
  useEffect(() => {
    if (!isOpen || isFetched) return;

    const fetchMuzakereler = async () => {
      setLoading(true);
      
      // Fetch comments
      const { data: commentsData, error: commentsError } = await supabase
        .from("comments")
        .select(`
          id, content, created_at, user_id,
          profiles (full_name, avatar_url)
        `)
        .eq("post_id", postId)
        .order("created_at", { ascending: false });

      if (commentsError) {
        toast.error("Müzakereler yüklenemedi");
        setLoading(false);
        return;
      }

      // Fetch all reactions for these comments in one go
      const commentIds = commentsData.map(c => c.id);
      let reactionsMap: Record<string, any[]> = {};
      
      if (commentIds.length > 0) {
        const { data: reactionsData } = await supabase
          .from("comment_reactions")
          .select("comment_id, reaction_type, user_id")
          .in("comment_id", commentIds);

        if (reactionsData) {
          reactionsData.forEach((r) => {
            if (!reactionsMap[r.comment_id]) reactionsMap[r.comment_id] = [];
            reactionsMap[r.comment_id].push(r);
          });
        }
      }

      // Merge Data
      const formattedComments: CommentWithReactions[] = commentsData.map((c: any) => {
        const cReactions = reactionsMap[c.id] || [];
        const myReaction = currentUser 
          ? cReactions.find((r: any) => r.user_id === currentUser.id)?.reaction_type 
          : null;

        return {
          ...c,
          user: c.profiles, // Flatten profile
          reactions: cReactions,
          woow_count: cReactions.filter((r: any) => r.reaction_type === 'woow').length,
          doow_count: cReactions.filter((r: any) => r.reaction_type === 'doow').length,
          adil_count: cReactions.filter((r: any) => r.reaction_type === 'adil').length,
          my_reaction: myReaction
        };
      });

      setComments(formattedComments);
      setLoading(false);
      setIsFetched(true);
    };

    fetchMuzakereler();
    
    // Optional: Set up Realtime Subscription here for 'comments' table INSERTs
    const channel = supabase
      .channel(`comments:${postId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'comments', 
        filter: `post_id=eq.${postId}` 
      }, (payload) => {
        // Handle incoming new comment (omitted for brevity, requires fetching profile)
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); }

  }, [isOpen, postId, currentUser, isFetched, supabase]);

  // 2. Client-Side Sorting: Score = Woow - Doow
  const sortedComments = useMemo(() => {
    return [...comments].sort((a, b) => {
      const scoreA = a.woow_count - a.doow_count;
      const scoreB = b.woow_count - b.doow_count;

      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Higher score first
      }
      // Tie-breaker: Newest first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [comments]);

  // 3. Handle Comment Submission (Optimistic UI)
  const handlePostComment = async () => {
    if (!newCommentText.trim()) return;
    if (!currentUser) return toast.error("Müzakereye katılmak için giriş yapmalısın.");
    
    // Constraint: Post owner cannot comment
    if (currentUser.id === postOwnerId) {
      return toast.error("Kendi gönderinize müzakere başlatamazsınız.");
    }

    const tempId = crypto.randomUUID();
    const tempComment: CommentWithReactions = {
      id: tempId,
      content: newCommentText,
      created_at: new Date().toISOString(),
      user_id: currentUser.id,
      user: { full_name: currentUser.user_metadata?.full_name || "Ben", avatar_url: "" },
      reactions: [],
      woow_count: 0,
      doow_count: 0,
      adil_count: 0,
      my_reaction: null
    };

    // Optimistic Update
    setComments((prev) => [tempComment, ...prev]);
    setNewCommentText("");
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase
        .from("comments")
        .insert({
          post_id: postId,
          user_id: currentUser.id,
          content: tempComment.content
        })
        .select()
        .single();

      if (error) throw error;

      // Replace temp ID with real ID
      setComments((prev) => prev.map(c => c.id === tempId ? { ...c, id: data.id } : c));

    } catch (err) {
      // Rollback
      toast.error("Yorum gönderilemedi.");
      setComments((prev) => prev.filter(c => c.id !== tempId));
      setNewCommentText(tempComment.content);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="w-full mt-4 bg-gray-50/50 rounded-xl p-4 border border-gray-100 animate-in fade-in slide-in-from-top-2 duration-300">
      
      {/* Input Area */}
      {currentUser && currentUser.id !== postOwnerId ? (
        <div className="flex gap-3 mb-6">
           <div className="flex-1 relative">
            <input
              type="text"
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder="Müzakereye katıl..."
              className="w-full bg-white border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all pr-10"
              onKeyDown={(e) => e.key === 'Enter' && handlePostComment()}
              disabled={isSubmitting}
            />
            <button 
              onClick={handlePostComment}
              disabled={!newCommentText.trim() || isSubmitting}
              className="absolute right-2 top-1.5 p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : null}

      {/* List Area */}
      {loading ? (
        <div className="py-8 text-center text-gray-400 text-sm">Müzakereler yükleniyor...</div>
      ) : sortedComments.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-sm">Henüz müzakere yok. İlk sen başlat!</div>
      ) : (
        <div className="space-y-4">
          {sortedComments.map((comment) => (
            <MuzakereItem 
              key={comment.id} 
              comment={comment} 
              currentUserId={currentUser?.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}