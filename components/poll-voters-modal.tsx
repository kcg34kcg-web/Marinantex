'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, User } from 'lucide-react';
import { Poll, PollOption } from '@/app/types';
import { getPollVoters } from '@/app/actions/poll-actions';
import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/utils/cn';

interface PollVotersModalProps {
  poll: Poll;
  isOpen: boolean;
  onClose: () => void;
  initialOptionId?: string; // Modalı açarken hangi sekme seçili gelsin?
}

export default function PollVotersModal({ poll, isOpen, onClose, initialOptionId }: PollVotersModalProps) {
  // Varsayılan olarak ilk seçeneği veya tıklanan seçeneği aç
  const [activeTab, setActiveTab] = useState<string>(initialOptionId || poll.options[0]?.id);
  const [voters, setVoters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal her açıldığında veya sekme değiştiğinde veriyi çek
  useEffect(() => {
    if (isOpen && activeTab) {
      fetchVoters(activeTab);
    }
  }, [isOpen, activeTab]);

  const fetchVoters = async (optionId: string) => {
    setLoading(true);
    const result = await getPollVoters(poll.id, optionId);
    if (result.success) {
      setVoters(result.data);
    } else {
      setVoters([]); // Hata veya boş durum
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Modal Container */}
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h3 className="font-bold text-gray-900">Oy Verenler</h3>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs (Seçenekler) */}
        <div className="flex overflow-x-auto p-2 gap-2 border-b border-gray-100 scrollbar-hide">
          {poll.options.sort((a, b) => a.display_order - b.display_order).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setActiveTab(opt.id)}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                activeTab === opt.id 
                  ? "bg-blue-600 text-white shadow-sm" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {opt.option_text.length > 20 ? opt.option_text.slice(0, 20) + '...' : opt.option_text}
              <span className="ml-2 opacity-80">({opt.vote_count})</span>
            </button>
          ))}
        </div>

        {/* User List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
              <Loader2 size={24} className="animate-spin text-blue-500" />
              <span className="text-xs">Yükleniyor...</span>
            </div>
          ) : voters.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
              <User size={32} className="opacity-20" />
              <span className="text-sm">Bu seçeneğe henüz kimse oy vermemiş.</span>
            </div>
          ) : (
            <div className="space-y-1">
              {voters.map((user) => (
                <Link 
                  key={user.user_id} 
                  href={`/profile/${user.user_id}`}
                  className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-xl transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden border border-gray-100 shrink-0">
                    {user.avatar_url ? (
                      <Image 
                        src={user.avatar_url} 
                        alt={user.username || "User"} 
                        width={40} 
                        height={40} 
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold">
                        {user.full_name?.[0] || "?"}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                      {user.full_name || "İsimsiz Kullanıcı"}
                    </span>
                    <span className="text-xs text-gray-500">@{user.username}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}