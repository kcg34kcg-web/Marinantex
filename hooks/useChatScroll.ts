import { useRef, useLayoutEffect } from 'react';

export function useChatScroll(dep: any) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);

  // Veri (mesajlar) değişmeden hemen önce mevcut pozisyonu kaydet
  useLayoutEffect(() => {
    if (scrollRef.current) {
      prevScrollHeightRef.current = scrollRef.current.scrollHeight;
      prevScrollTopRef.current = scrollRef.current.scrollTop;
    }
  }, [dep]);

  // Veri güncellendikten sonra pozisyonu düzelt (Scroll Anchoring)
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    
    const currentScrollHeight = scrollRef.current.scrollHeight;
    const heightDifference = currentScrollHeight - prevScrollHeightRef.current;

    // Eğer kullanıcı en üstteyse ve yeni veri yüklendiyse (Eski mesajları yüklüyorsa)
    // Scrollu aşağı iterek kullanıcının gördüğü mesajı sabit tut
    if (prevScrollTopRef.current < 50 && heightDifference > 0) {
       scrollRef.current.scrollTop = prevScrollTopRef.current + heightDifference;
    } 
    // Eğer kullanıcı en alttaysa ve yeni mesaj geldiyse (Canlı sohbet)
    // Otomatik aşağı kaydır
    else if (
        prevScrollHeightRef.current - prevScrollTopRef.current <= scrollRef.current.clientHeight + 100
    ) {
        scrollRef.current.scrollTop = currentScrollHeight;
    }
  }, [dep]);

  return scrollRef;
}