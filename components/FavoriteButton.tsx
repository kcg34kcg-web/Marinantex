"use client";

import { useState, useEffect } from "react"; // DÜZELTME: useEffect eklendi
import { Star } from "lucide-react";
import { toggleFavoriteAction } from "@/app/actions/favorite";
import { cn } from "@/utils/cn";

interface FavoriteButtonProps {
  itemId: string;
  initialIsFavorited: boolean;
  type?: 'question' | 'answer';
}

export default function FavoriteButton({ itemId, initialIsFavorited, type = 'question' }: FavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(initialIsFavorited);
  const [loading, setLoading] = useState(false);

  // --- KRİTİK DÜZELTME BURASI ---
  // Dashboard veriyi sonradan yükleyip gönderdiğinde, 
  // butonun da bu değişikliği algılayıp kendini güncellemesini sağlıyoruz.
  useEffect(() => {
    setIsFavorited(initialIsFavorited);
  }, [initialIsFavorited]);
  // -----------------------------

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault(); 
    e.stopPropagation();
    
    if (loading) return;
    setLoading(true);

    const newState = !isFavorited;
    setIsFavorited(newState); // Hızlı tepki (Optimistic UI)

    try {
      await toggleFavoriteAction(itemId, type);
    } catch (error) {
      // Hata olursa geri al
      setIsFavorited(!newState);
      console.error("Favori işlemi hatası:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button 
      onClick={handleToggle}
      disabled={loading}
      className={cn(
        "p-2 rounded-full transition-all active:scale-90",
        isFavorited ? "bg-orange-50" : "hover:bg-gray-100"
      )}
    >
      <Star 
        size={22} 
        className={cn(
          "transition-colors duration-300",
          isFavorited 
            ? "fill-orange-400 text-orange-400 animate-bounce-slight" // Renkleri de netleştirdik
            : "text-gray-400"
        )} 
      />
    </button>
  );
}