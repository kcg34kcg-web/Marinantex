'use client';

import { useEffect, useState, useRef, useMemo, useCallback, memo } from 'react';
import { createClient } from '@/utils/supabase/client';
import ReactionBar from './ReactionBar';
import CommentSection from './CommentSection';
import WiltedRoseMenu from './WiltedRoseMenu';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, ShieldCheck, Zap, Ticket, Calendar, MapPin, ArrowRight } from 'lucide-react'; 
import { motion, useAnimation } from 'framer-motion';
import { fetchFeed } from '@/app/actions/feed'; 
import PollCard from './poll-card'; // YENİ: PollCard import edildi

// --- OPTİMİZASYON 1: İkonu dışarı aldık ---
const PegasusIcon = memo(({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
     <path d="M12 2C8 2 6 4 6 6V8H5C3.3 8 2 9.3 2 11V14C2 15.7 3.3 17 5 17H6V20C6 21.1 6.9 22 8 22H16C17.1 22 18 21.1 18 20V17H19C20.7 17 22 15.7 22 14V11C22 9.3 20.7 8 19 8H18V6C18 4 16 2 12 2ZM8 18H16V20H8V18ZM18 15H6V11C6 10.4 6.4 10 7 10H17C17.6 10 18 10.4 18 11V15ZM10 6C10 5.4 10.4 5 11 5H13C13.6 5 14 5.4 14 6V8H10V6Z" />
     <path d="M4 12L2 10M20 12L22 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
));
PegasusIcon.displayName = 'PegasusIcon';

// --- TİP TANIMLARI (GÜNCELLENDİ) ---
// Artık hem Post hem Poll verilerini kapsayacak esnek bir yapı kullanıyoruz
interface FeedItemData {
  id: string;
  type?: 'post' | 'poll'; // Tür ayrımı
  user_id: string;
  created_at: string;
  
  // Ortak Yazar Bilgileri
  author_name: string;
  author_avatar: string;
  author_username?: string;
  author_reputation?: number;

  // Post Alanları
  content?: string;
  image_url?: string;
  woow_count?: number;
  doow_count?: number;
  adil_count?: number;
  comment_count?: number;
  my_reaction?: 'woow' | 'doow' | 'adil' | null;
  score?: number;
  is_event?: boolean;
  event_date?: string;
  event_location?: any;

  // Poll Alanları
  question?: string;
  options?: any[];
  expires_at?: string;
  is_closed?: boolean;
  is_anonymous?: boolean;
  user_vote?: string | null;
}

// --- OPTİMİZASYON 2: PostItem ---
const PostItem = memo(({ 
  post, 
  currentUserId, 
  isExpanded, 
  onToggle 
}: { 
  post: FeedItemData, 
  currentUserId: string | null, 
  isExpanded: boolean, 
  onToggle: (id: string) => void 
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  
  const [isVisible, setIsVisible] = useState(true);
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  const controls = useAnimation();
  
  const triggerPhysics = useCallback(() => {
    controls.start({
      x: [0, -3, 3, -2, 2, 0], 
      scale: [1, 1.015, 1],    
      transition: { duration: 0.35, ease: "easeOut" }
    });
  }, [controls]);
  
  // --- HATA DÜZELTME: content kontrolü ---
  const contentText = post.content || ""; // Eğer undefined ise boş string al
  const MAX_LENGTH = 280;
  const isTooLong = contentText.length > MAX_LENGTH;
  const displayContent = isTooLong && !isContentExpanded
    ? contentText.slice(0, MAX_LENGTH) + "..." 
    : contentText;

  const renderBadge = () => {
    const rep = post.author_reputation || 0;
    if (rep >= 5000) return <ShieldCheck size={16} className="text-pink-500 fill-pink-50 ml-1 inline-block align-text-bottom" />;
    if (rep >= 1000) return <Zap size={16} className="text-amber-400 fill-amber-50 ml-1 inline-block align-text-bottom" />;
    if (rep >= 100) return <BadgeCheck size={16} className="text-blue-500 fill-blue-50 ml-1 inline-block align-text-bottom" />;
    return null;
  };

  if (!isVisible) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!isExpanded || !cardRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) onToggle(post.id); 
      },
      { threshold: 0 }
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [isExpanded, onToggle, post.id]);

  const goToFullView = useCallback(() => {
    router.push(`/post/${post.id}`);
  }, [router, post.id]);

  const goToProfile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/profile/${post.user_id}`);
  }, [router, post.user_id]);

  return (
    <motion.div 
      ref={cardRef} 
      animate={controls} 
      layout="position" 
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow relative group ${
        post.is_event ? 'border-blue-200 shadow-blue-50' : 'border-slate-200'
      }`}
    >
      
      {/* HEADER */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={goToFullView}>
            <div 
              className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold overflow-hidden border border-slate-100 transition-transform hover:scale-105"
              onClick={goToProfile}
            >
              {post.author_avatar ? (
                <Image 
                  src={post.author_avatar} 
                  alt="" 
                  width={40} 
                  height={40} 
                  className="object-cover w-full h-full"
                  loading="lazy" 
                />
              ) : (
                post.author_name?.[0]?.toUpperCase() || '?'
              )}
            </div>

            <div className="flex flex-col justify-center">
              <div className="flex items-center">
                  <h3 
                    className="font-semibold text-slate-900 hover:underline hover:text-amber-600 transition-colors mr-1"
                    onClick={goToProfile}
                  >
                      {post.author_name}
                  </h3>
                  {renderBadge()}
              </div>
              
              {post.author_username && (
                 <span className="text-sm text-slate-500 font-medium block -mt-0.5">
                   @{post.author_username}
                 </span>
              )}

              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                 <span>{formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: tr })}</span>
              </div>
            </div>
        </div>

        <div className="text-slate-400 hover:text-slate-600 transition-colors">
            <WiltedRoseMenu 
                postId={post.id} 
                authorId={post.user_id} 
                onOptimisticHide={() => setIsVisible(false)} 
            />
        </div>
      </div>

      {/* CONTENT */}
      <div className="px-4 pb-2">
        {post.is_event && (
           <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-600 border border-blue-100 shadow-sm">
                 <Ticket size={12} strokeWidth={2.5} />
                 Etkinlik
              </div>
              {post.event_date && (
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50/50 border border-blue-100 text-blue-600 text-[11px] font-semibold">
                  <Calendar size={12} className="shrink-0" />
                  <span>{new Date(post.event_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</span>
                </div>
              )}
              {post.event_location && post.event_location.name && (
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-orange-50/50 border border-orange-100 text-orange-600 text-[11px] font-semibold truncate max-w-[180px]">
                  <MapPin size={12} className="shrink-0" />
                  <span className="truncate">{post.event_location.name}</span>
                </div>
              )}
           </div>
        )}

        <p className="text-slate-700 whitespace-pre-wrap mb-3 leading-relaxed text-[15px]">
          {displayContent}
          {isTooLong && !isContentExpanded && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsContentExpanded(true);
              }}
              className="text-amber-600 font-medium hover:underline ml-1 inline-block"
            >
              Devamını gör
            </button>
          )}
        </p>

        {post.image_url && (
          <div 
            className="relative w-full h-64 mb-3 rounded-xl overflow-hidden border border-slate-100 cursor-pointer shadow-sm"
            onClick={goToFullView}
          >
            <Image 
              src={post.image_url} 
              alt="Post Görseli" 
              fill 
              className="object-cover" 
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        )}

        {post.is_event && (
           <button 
                onClick={(e) => {
                    e.stopPropagation();
                    goToFullView();
                }}
                className="mt-3 w-full group/btn relative overflow-hidden rounded-xl border border-slate-200 hover:border-blue-300 transition-all duration-300 shadow-sm hover:shadow-md"
           >
                <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 via-transparent to-orange-50/50 opacity-100 group-hover/btn:opacity-0 transition-opacity" />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-900 to-blue-900 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                <div className="relative z-10 flex items-center justify-center gap-2 py-2.5 px-4">
                    <Ticket size={16} className="text-orange-500 group-hover/btn:text-white transition-colors duration-300 rotate-0 group-hover/btn:-rotate-12" />
                    <span className="text-sm font-bold text-slate-700 group-hover/btn:text-white transition-colors duration-300">Etkinlik Detayları & Katıl</span>
                    <ArrowRight size={14} className="text-slate-400 group-hover/btn:text-orange-400 group-hover/btn:translate-x-1 transition-all duration-300" />
                </div>
           </button>
        )}
      </div>

      <div className="px-4 pb-4 border-t border-slate-50 pt-2 bg-slate-50/50">
        <ReactionBar 
          targetId={post.id}
          targetType="post"
          initialCounts={{
            woow: post.woow_count || 0,
            doow: post.doow_count || 0,
            adil: post.adil_count || 0,
            comment_count: post.comment_count || 0
          }}
          initialUserReaction={post.my_reaction || null}
          isOwner={currentUserId === post.user_id}
          onMuzakereClick={() => onToggle(post.id)} 
          onTriggerPhysics={triggerPhysics}
        />
      </div>

      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/30 px-4 py-4 animate-in slide-in-from-top-2">
          <CommentSection postId={post.id} postOwnerId={post.user_id} />
        </div>
      )}
    </motion.div>
  );
}, (prevProps, nextProps) => {
    return (
        prevProps.post.id === nextProps.post.id &&
        prevProps.isExpanded === nextProps.isExpanded &&
        prevProps.currentUserId === nextProps.currentUserId &&
        prevProps.post.my_reaction === nextProps.post.my_reaction &&
        prevProps.post.woow_count === nextProps.post.woow_count &&
        prevProps.post.comment_count === nextProps.post.comment_count
    );
});

PostItem.displayName = 'PostItem';


// --- POST LİSTESİ ---
export default function PostList({ userId, filter = 'all', searchQuery }: { userId?: string, filter?: 'all' | 'events', searchQuery?: string }) {
  const [posts, setPosts] = useState<FeedItemData[]>([]);
  const [newPosts, setNewPosts] = useState<FeedItemData[]>([]);
  const [spotlight, setSpotlight] = useState<any>(null); 
  const [loading, setLoading] = useState(true);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  
  const supabase = createClient();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const handleToggle = useCallback((id: string) => {
    setExpandedPostId(prev => prev === id ? null : id);
  }, []);

  useEffect(() => {
    // Post Eventi
    const handleNewPost = (event: CustomEvent) => {
      const newPost = event.detail;
      if (newPost) {
        const formattedNewPost: FeedItemData = {
            ...newPost,
            type: 'post',
            author_name: newPost.profiles?.full_name || 'Ben',
            author_username: newPost.profiles?.username || 'ben',
            author_avatar: newPost.profiles?.avatar_url,
            author_reputation: newPost.profiles?.reputation,
            woow_count: 0, doow_count: 0, adil_count: 0, comment_count: 0,
            my_reaction: null
        };
        setNewPosts(prev => [formattedNewPost, ...prev]);
      }
    };

    // YENİ: Poll Eventi
    const handleNewPoll = (event: CustomEvent) => {
        const newPoll = event.detail;
        if (newPoll) {
          const formattedPoll: FeedItemData = {
             id: newPoll.id,
             type: 'poll',
             user_id: newPoll.creator_id, // createPost'ta creator_id dönüyor olabilir
             created_at: newPoll.created_at,
             author_name: 'Ben', // Profil join edilmediyse default
             author_avatar: '', // TODO: Context'ten al
             question: newPoll.question,
             options: newPoll.options || [],
             expires_at: newPoll.expires_at,
             is_closed: false
          };
          setNewPosts(prev => [formattedPoll, ...prev]);
        }
    };

    window.addEventListener('new-post-created' as any, handleNewPost);
    window.addEventListener('new-poll-created' as any, handleNewPoll);
    return () => {
        window.removeEventListener('new-post-created' as any, handleNewPost);
        window.removeEventListener('new-poll-created' as any, handleNewPoll);
    };
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      const cUserId = user?.id || null;
      setCurrentUserId(cUserId);

      let currentUserProfile: any = null;
      if (cUserId) {
        const { data } = await supabase.from('profiles').select('username, full_name, avatar_url, reputation').eq('id', cUserId).single();
        currentUserProfile = data;
      }

      let pageOwnerProfile: any = null;
      if (userId) {
         if (userId === cUserId && currentUserProfile) {
             pageOwnerProfile = currentUserProfile;
         } else {
             const { data } = await supabase.from('profiles').select('username, full_name, avatar_url, reputation').eq('id', userId).single();
             pageOwnerProfile = data;
         }
      }

      // --- MAPPER FONKSİYONU GÜNCELLENDİ (Poll Desteği) ---
      const mapToFeedItem = (p: any): FeedItemData => {
        const ownerId = p.author_id || p.user_id || p.creator_id;
        const isMine = ownerId === cUserId;
        
        let finalUsername = p.author_username; 
        let finalFullName = p.author_name;
        let finalAvatar = p.author_avatar;
        let finalReputation = p.author_reputation;

        if (userId && pageOwnerProfile && ownerId === userId) {
             finalUsername = pageOwnerProfile.username; 
             finalFullName = pageOwnerProfile.full_name;
             finalAvatar = pageOwnerProfile.avatar_url;
             finalReputation = pageOwnerProfile.reputation;
        } 
        else if (isMine && currentUserProfile) {
             if (!finalUsername) finalUsername = currentUserProfile.username;
             if (!finalFullName) finalFullName = currentUserProfile.full_name;
             if (!finalAvatar) finalAvatar = currentUserProfile.avatar_url;
             if (finalReputation === undefined) finalReputation = currentUserProfile.reputation;
        }
        
        if (!finalUsername) finalUsername = p.username;
        if (!finalFullName) finalFullName = p.full_name;

        return {
            id: p.id,
            type: p.type || (p.question ? 'poll' : 'post'), // Tip tahmini
            user_id: ownerId, 
            content: p.content, // Poll ise undefined olabilir, PostItem'da kontrol ettik
            created_at: p.created_at,
            author_name: finalFullName || "İsimsiz",
            author_username: finalUsername, 
            author_reputation: finalReputation || 0,
            author_avatar: finalAvatar || p.avatar_url,
            woow_count: p.woow_count,
            doow_count: p.doow_count,
            adil_count: p.adil_count, 
            comment_count: p.comment_count,
            my_reaction: p.my_reaction, 
            image_url: p.image_url,
            score: p.score,
            is_event: p.is_event,
            event_date: p.event_date,
            event_location: p.event_location,
            
            // Poll Özellikleri
            question: p.question,
            options: p.options,
            expires_at: p.expires_at,
            is_closed: p.is_closed,
            user_vote: p.user_vote
        };
      };

      if (cUserId) {
         if (userId) {
            // Profil sayfası (Henüz poll desteği yoksa sadece post çeker)
            let query = supabase
                .from('posts_with_stats') 
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            
            if (searchQuery) {
                query = query.ilike('content', `%${searchQuery}%`);
            }

            const { data } = await query;
            if (data) {
                const mapped = data.map(mapToFeedItem);
                setPosts(mapped); 
            }
         } 
         else {
            try {
                // FetchFeed artık Mixed Array dönüyor
                const { posts: smartPosts, spotlight: smartSpotlight } = await fetchFeed(cUserId, searchQuery);
                const mapped = smartPosts.map(mapToFeedItem);
                setPosts(mapped);
                setSpotlight(smartSpotlight);
            } catch (error) {
                console.error("Feed yüklenirken hata:", error);
            }
         }
      }
      setLoading(false);
    };

    init();
  }, [userId, searchQuery]); 

  const finalDisplayList = useMemo(() => {
    const displayedFetchedPosts = filter === 'events' 
      ? posts.filter(p => p.is_event) 
      : posts;

    const displayedNewPosts = filter === 'events'
      ? newPosts.filter(p => p.is_event)
      : newPosts;

    return [...displayedNewPosts, ...displayedFetchedPosts];
  }, [posts, newPosts, filter]);

  if (loading) {
    return (
        <div className="space-y-4">
           {[1, 2, 3].map(i => (
             <div key={i} className="bg-white p-6 rounded-2xl h-48 animate-pulse border border-slate-100 shadow-sm" />
           ))}
        </div>
    );
  }
  
  if (finalDisplayList.length === 0) {
    return (
      <div className="p-12 text-center bg-white rounded-2xl border border-dashed border-slate-300">
        <p className="text-slate-500 font-medium">
          {searchQuery 
            ? `"${searchQuery}" için sonuç bulunamadı.` 
            : filter === 'events' ? 'Planlanmış etkinlik bulunamadı.' : 'Henüz paylaşım yok.'}
        </p>
        {!searchQuery && <p className="text-sm text-slate-400 mt-1">Sessizliği bozan ilk kişi sen ol.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!userId && filter === 'all' && !searchQuery && spotlight && (
        <div className="relative overflow-hidden rounded-xl p-0.5 bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-600 shadow-lg shadow-amber-500/20 group animate-in fade-in slide-in-from-top-4">
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
            <div className="bg-slate-900 rounded-[10px] p-4 flex items-center gap-4 relative">
                <div className="absolute top-0 right-0 p-4 opacity-20 text-yellow-300 animate-pulse">
                    <PegasusIcon className="w-24 h-24 rotate-12" />
                </div>
                <div className="bg-gradient-to-br from-amber-300 to-yellow-600 p-3 rounded-full text-slate-900 shrink-0 shadow-lg shadow-amber-500/40 z-10">
                    <PegasusIcon className="w-6 h-6" />
                </div>
                <div className="relative z-10">
                    <h4 className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-yellow-400 font-black text-[11px] uppercase tracking-widest mb-1 flex items-center gap-2">
                        GOLDEN TICKET <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-ping"/>
                    </h4>
                    <div className="flex items-center gap-2">
                       <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-slate-900 overflow-hidden border border-yellow-300">
                          {spotlight.avatar_url ? <img src={spotlight.avatar_url} className="w-full h-full object-cover" alt="spotlight"/> : spotlight.username?.[0]}
                       </div>
                       <p className="text-slate-200 text-sm">
                          <Link href={`/profile/${spotlight.id}`} className="font-bold hover:text-amber-400 transition-colors text-white">
                              @{spotlight.username}
                          </Link> 15 dakikalığına vitrinde!
                       </p>
                    </div>
                </div>
            </div>
        </div>
      )}

      {finalDisplayList.map((item) => {
        // --- AYRIŞTIRMA MANTIĞI ---
        if (item.type === 'poll') {
           // Type Casting yaparak PollCard'a gönderiyoruz
           return (
             <PollCard 
               key={item.id} 
               poll={item as any} 
               currentUserId={currentUserId || undefined} 
             />
           );
        } else {
           return (
             <PostItem 
               key={item.id} 
               post={item} 
               currentUserId={currentUserId}
               isExpanded={expandedPostId === item.id}
               onToggle={handleToggle} 
             />
           );
        }
      })}
    </div>
  );
}