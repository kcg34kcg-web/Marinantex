"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Flame, ThumbsDown, Scale } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/utils/cn"; // Helper for conditional classes

type ReactionType = "woow" | "doow" | "adil";

interface MuzakereItemProps {
  comment: any;
  currentUserId: string | null;
}

export default function MuzakereItem({ comment, currentUserId }: MuzakereItemProps) {
  const supabase = createClient();
  const isOwner = currentUserId === comment.user_id;

  // Local State for Optimistic UI
  const [counts, setCounts] = useState({
    woow: comment.woow_count,
    doow: comment.doow_count,
    adil: comment.adil_count,
  });
  const [myReaction, setMyReaction] = useState<ReactionType | null>(comment.my_reaction);
  const [isPending, setIsPending] = useState(false);

  const handleReaction = async (type: ReactionType) => {
    if (!currentUserId) return toast.error("Reaksiyon vermek için giriş yapın.");
    if (isOwner) return toast.error("Kendi yorumunuza reaksiyon veremezsiniz.");
    if (isPending) return;

    // Snapshot for Rollback
    const prevReaction = myReaction;
    const prevCounts = { ...counts };

    // 1. Optimistic Update Logic
    let newCounts = { ...counts };
    let newReaction = type;

    // Logic: If clicking same reaction, remove it (toggle off). Else, switch.
    if (prevReaction === type) {
      newCounts[type] = Math.max(0, newCounts[type] - 1);
      newReaction = null as any; 
    } else {
      if (prevReaction) {
        newCounts[prevReaction] = Math.max(0, newCounts[prevReaction] - 1);
      }
      newCounts[type] += 1;
    }

    setCounts(newCounts);
    setMyReaction(newReaction);
    setIsPending(true);

    try {
      // 2. DB Interaction
      if (newReaction === null) {
        // DELETE
        await supabase
          .from("comment_reactions")
          .delete()
          .match({ comment_id: comment.id, user_id: currentUserId });
      } else {
        // UPSERT (handled by deleting old one first in SQL function or simple separate calls)
        // Since we have a unique constraint, we can use upsert if we select on conflict,
        // BUT Supabase basic upsert checks Primary Key. 
        // Best approach for Composite Key constraint:
        // We simply upsert directly because of the unique index on (comment_id, user_id).
        
        // Note: Standard Supabase .upsert works with constraints if configured, 
        // but explicit delete-then-insert is safer for reaction switching logic to ensure clean state.
        // Actually, pure UPSERT is best here:
        
        const { error } = await supabase
          .from("comment_reactions")
          .upsert(
            {
              comment_id: comment.id,
              user_id: currentUserId,
              reaction_type: type
            },
            { onConflict: 'comment_id, user_id' }
          );

        if (error) throw error;
      }
    } catch (error) {
      // 3. Rollback on Error
      console.error(error);
      setCounts(prevCounts);
      setMyReaction(prevReaction);
      toast.error("İşlem başarısız.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
      {/* Comment Header & Content */}
      <div className="mb-2">
        <span className="text-xs font-bold text-gray-900 mr-2">
          {comment.user?.full_name || "Anonim"}
        </span>
        <span className="text-sm text-gray-700">{comment.content}</span>
      </div>

      {/* Reaction Bar - "No Ripple", Instant Feedback */}
      <div className="flex items-center gap-1 mt-1">
        
        {/* Woow Button */}
        <button
          onClick={() => handleReaction("woow")}
          disabled={isOwner}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-none select-none", // transition-none removes ripple/fade
            myReaction === "woow" 
              ? "bg-orange-100 text-orange-600" 
              : "text-gray-400 hover:bg-gray-50",
            isOwner && "opacity-50 cursor-not-allowed"
          )}
        >
          <Flame size={14} className={cn(myReaction === "woow" && "fill-current")} />
          <span>{counts.woow > 0 && counts.woow}</span>
        </button>

        {/* Doow Button */}
        <button
          onClick={() => handleReaction("doow")}
          disabled={isOwner}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-none select-none",
            myReaction === "doow" 
              ? "bg-slate-100 text-slate-700" 
              : "text-gray-400 hover:bg-gray-50",
            isOwner && "opacity-50 cursor-not-allowed"
          )}
        >
          <ThumbsDown size={14} className={cn(myReaction === "doow" && "fill-current")} />
          <span>{counts.doow > 0 && counts.doow}</span>
        </button>

        {/* Adil Button */}
        <button
          onClick={() => handleReaction("adil")}
          disabled={isOwner}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-none select-none",
            myReaction === "adil" 
              ? "bg-blue-100 text-blue-600" 
              : "text-gray-400 hover:bg-gray-50",
            isOwner && "opacity-50 cursor-not-allowed"
          )}
        >
          <Scale size={14} className={cn(myReaction === "adil" && "fill-current")} />
          <span>{counts.adil > 0 && counts.adil}</span>
        </button>

      </div>
    </div>
  );
}