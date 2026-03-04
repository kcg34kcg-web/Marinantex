'use client';

import React, { useState, memo } from 'react';
import { Bird, CornerDownRight } from 'lucide-react';
import toast from 'react-hot-toast';
import ReactionBar from './ReactionBar';
import { CommentNode } from '@/utils/commentTree';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';

interface CommentItemProps {
  node: CommentNode;
  currentUserId: string | null;
  currentUserData?: any; // To check logic instantly
  onReply: (parentId: string, content: string) => Promise<void>;
  depth?: number;
}

const CommentItem = memo(({ node, currentUserId, currentUserData, onReply, depth = 0 }: CommentItemProps) => {
  const [replyInput, setReplyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  
  // Logic: Auto-hide replies if depth > 3 to keep UI clean initially
  const [areChildrenVisible, setAreChildrenVisible] = useState(depth < 3);
  
  // Logic: Pagination for replies (Show 3 initially)
  const [visibleChildCount, setVisibleChildCount] = useState(3);

  // Self-Negotiation Check for Replies
  const canReply = currentUserId !== node.user_id;

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyInput.trim()) return;
    
    // Safety check again
    if (!canReply) {
      toast.error("Kendi yorumunuzla müzakere edemezsiniz.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onReply(node.id, replyInput);
      setReplyInput("");
      setIsFocused(false);
      setAreChildrenVisible(true); // Auto-expand to show new reply
      setVisibleChildCount(prev => prev + 1); // Ensure new item is visible
      toast.success("Yanıt eklendi!");
    } catch (error) {
      // Error handled in parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const visibleChildren = node.children.slice(0, visibleChildCount);
  const remainingChildren = node.children.length - visibleChildCount;

  return (
    <div className="flex flex-col w-full animate-in fade-in duration-300 relative">
      
      {/* --- COMMENT CARD --- */}
      <div className="flex gap-3 group relative z-10">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden">
            {node.author_avatar ? (
              <img src={node.author_avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-50">
                {node.author_name?.charAt(0) || "?"}
              </div>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 min-w-0">
          <div className={`p-3 rounded-2xl border transition-all duration-200 ${
            isFocused ? 'bg-white border-purple-300 shadow-md ring-1 ring-purple-100' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-slate-900">{node.author_name}</span>
              
              {/* --- YENİ EKLENEN KISIM: KULLANICI ADI --- */}
              {/* Eğer veri varsa ve isimden farklıysa gösterir */}
              {node.author_username && (
                <span className="text-xs text-slate-500 font-normal">
                  @{node.author_username}
                </span>
              )}
              
              <span className="text-[10px] text-slate-400">
                {formatDistanceToNow(new Date(node.created_at), { addSuffix: true, locale: tr })}
              </span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {node.content}
            </p>
          </div>

          {/* Reaction Bar & Actions */}
          <div className="mt-1.5 ml-1 flex items-center gap-4">
             <ReactionBar
               targetId={node.id}
               targetType="comment" // PHASE 1 FIX: Explicit Type
               initialCounts={{
                 woow: node.woow_count,
                 doow: node.doow_count,
                 adil: node.adil_count,
                 comment_count: node.reply_count
               }}
               initialUserReaction={node.my_reaction}
               isOwner={currentUserId === node.user_id}
               onMuzakereClick={() => {
                 if (canReply) {
                   setIsFocused(!isFocused);
                 } else {
                   toast.error("Kendi yorumunuzla müzakere edemezsiniz.");
                 }
               }}
             />
          </div>

          {/* Recursive Input */}
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isFocused ? 'max-h-40 opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
            <form onSubmit={handleReplySubmit} className="relative flex items-center gap-2">
              <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-purple-100 rounded-full" />
              <div className="flex-1 relative ml-2">
                <input 
                  type="text" 
                  value={replyInput}
                  autoFocus={isFocused}
                  onChange={(e) => setReplyInput(e.target.value)}
                  placeholder={`@${node.author_name} ile müzakere et...`}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:bg-white focus:border-purple-300 transition-all"
                />
                <button 
                  type="submit" 
                  disabled={!replyInput.trim() || isSubmitting}
                  className="absolute right-1.5 top-1.5 p-1.5 text-white bg-slate-900 rounded-lg hover:bg-black disabled:opacity-30 transition-all"
                >
                  <Bird size={14} />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* --- NESTED THREAD (VISUAL HIERARCHY) --- */}
      {node.children.length > 0 && (
        <div className="relative mt-2">
          {!areChildrenVisible ? (
             <button 
               onClick={() => setAreChildrenVisible(true)}
               className="ml-12 mt-1 text-xs font-semibold text-purple-600 hover:underline flex items-center gap-1"
             >
               <CornerDownRight size={12} />
               {node.children.length} yanıtı göster...
             </button>
          ) : (
            <div className="flex">
               {/* GUIDE LINE (The Tree Stem) */}
               <div className="ml-4 flex flex-col items-center relative">
                  {/* Vertical Line */}
                  <div className="absolute top-0 bottom-4 left-0 w-[2px] bg-slate-200" />
               </div>

               {/* Children Container with Indentation */}
               <div className="flex-1 min-w-0 ml-6 space-y-4 pt-2">
                 {visibleChildren.map((child) => (
                   <div key={child.id} className="relative">
                     {/* L-Shape Connector (Pseudo-element visual) */}
                     <div className="absolute -left-6 top-5 w-4 h-[2px] bg-slate-200 rounded-bl-lg"></div>
                     
                     <CommentItem 
                       node={child}
                       currentUserId={currentUserId}
                       currentUserData={currentUserData}
                       onReply={onReply}
                       depth={depth + 1}
                     />
                   </div>
                 ))}
                 
                 {/* Sub-Pagination Button */}
                 {remainingChildren > 0 && (
                   <button 
                     onClick={() => setVisibleChildCount(prev => prev + 5)}
                     className="text-xs font-bold text-slate-500 hover:text-purple-600 pl-2 pt-1 flex items-center gap-1 transition-colors relative z-10"
                   >
                     <CornerDownRight size={12} />
                     {remainingChildren} diğer yanıtı göster...
                   </button>
                 )}
               </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

CommentItem.displayName = 'CommentItem';

export default CommentItem;