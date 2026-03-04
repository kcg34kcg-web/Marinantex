'use client'

import { useState } from 'react';
import { MoreHorizontal, Flower2, Ban, EyeOff, Flag } from 'lucide-react'; 
import { handleInteraction } from '@/app/actions/interact'; 

// HATA ÇÖZÜMÜ: Sonner yoksa bile kodun çalışması için bu satırı kapattık.
// import { toast } from 'sonner'; 

interface WiltedRoseProps {
  postId: string;
  authorId: string;
  onOptimisticHide: () => void; // Postu anında ekrandan silen fonksiyon
}

export default function WiltedRoseMenu({ 
  postId, 
  authorId, 
  onOptimisticHide 
}: WiltedRoseProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // İşlem yapılırken butona tekrar basılmasını engellemek için loading durumu
  const [isLoading, setIsLoading] = useState(false);

  // Fallback: Eğer Sonner yoksa konsola basar, varsa burayı değiştirebilirsiniz.
  const notifyUser = (message: string, isError = false) => {
    // Projenizde başka bir toast varsa buraya ekleyebilirsiniz.
    console.log(`[Bildirim]: ${message}`);
  };

  const performAction = async (action: 'not_interested' | 'block' | 'mute') => {
    if (isLoading) return;
    
    setIsLoading(true);
    setIsOpen(false); // Menüyü hemen kapat

    
    onOptimisticHide(); 

    try {
      // 2. SERVER ACTION (Arka planda çalışır)
      await handleInteraction(postId, authorId, action);
      
      // Kullanıcıya sessizce bilgi ver (Opsiyonel)
      if (action === 'not_interested') notifyUser("İlgilenmiyorum olarak işaretlendi");
      if (action === 'block') notifyUser("Kullanıcı engellendi");
      if (action === 'mute') notifyUser("Kullanıcı sessize alındı");

    } catch (e) {
      console.error("İşlem hatası:", e);
      // Hata olsa bile postu geri getirmek kullanıcıyı şaşırtır,
      // bu yüzden genelde sessiz kalınır veya genel bir hata gösterilir.
      notifyUser("İşlem sunucuda kaydedilemedi", true);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="relative">
      {/* Tetikleyici Buton */}
      <button 
        onClick={(e) => {
            e.stopPropagation(); // Tıklamanın karta yayılmasını engelle
            setIsOpen(!isOpen);
        }}
        className="text-stone-400 hover:text-stone-600 transition-colors p-2 rounded-full hover:bg-stone-100"
      >
        <MoreHorizontal size={20} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop: Menü dışına tıklayınca kapanması için */}
          <div 
            className="fixed inset-0 z-40 bg-transparent" 
            onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
            }} 
          />

          {/* Menü Dropdown (Görsel Tasarım Korundu) */}
          <div className="absolute right-0 mt-2 w-56 bg-white border border-stone-200 shadow-xl rounded-md z-50 overflow-hidden font-serif animate-in fade-in zoom-in-95 duration-100">
            
            {/* Solgun Gül (Wilted Rose) Seçeneği */}
            <button
              onClick={() => performAction('not_interested')}
              className="w-full text-left px-4 py-3 text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-3 border-b border-stone-100 transition-colors group"
            >
              {/* Gül İkonu: Hover olunca rengi solsun */}
              <Flower2 size={18} className="text-rose-700 rotate-180 group-hover:text-rose-900 transition-colors" /> 
              <div>
                <span className="block font-medium">İlgimi Çekmiyor</span>
                <span className="text-xs text-stone-400">Benzerlerini daha az göster</span>
              </div>
            </button>

            <button
              onClick={() => performAction('mute')}
              className="w-full text-left px-4 py-2.5 text-sm text-stone-600 hover:bg-stone-50 flex items-center gap-3 transition-colors"
            >
              <EyeOff size={16} />
              <span>Sessize Al</span>
            </button>

            <button
              onClick={() => performAction('block')}
              className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
            >
              <Ban size={16} />
              <span>Engelle</span>
            </button>
            
             <button
              onClick={() => setIsOpen(false)}
              className="w-full text-left px-4 py-2.5 text-sm text-stone-400 hover:bg-stone-50 flex items-center gap-3 transition-colors"
            >
              <Flag size={16} />
              <span>Bildir</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}