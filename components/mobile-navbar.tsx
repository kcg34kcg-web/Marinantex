"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Home, 
  MessageCircle, 
  PlusCircle, 
  BookOpen, 
  ShoppingBag, 
  User, 
  Zap, // Lexwoow ikonu için enerjik bir sembol
  HelpCircle, 
  PenTool 
} from "lucide-react"; 
import { cn } from "@/utils/cn";

export default function MobileNavbar() {
  const pathname = usePathname();

  // YENİ SIRALAMA:
  // Ana Akış -> Lexwoow -> Soru Sor -> Cevapla -> Yayınlar -> Market -> Hesabım
  const navItems = [
    { label: "Akış", href: "/main", icon: Home },
    { 
      label: "Lexwoow", 
      href: "/lexwoow", // Bu sayfayı oluşturmanız gerekecek, şimdilik placeholder
      icon: Zap, 
      isSpecial: true 
    },
    { label: "Sor", href: "/ask", icon: PlusCircle },
    { label: "Cevapla", href: "/questions", icon: MessageCircle }, 
    { label: "Yayın", href: "/publications", icon: BookOpen },
    { label: "Market", href: "/market", icon: ShoppingBag },
    { label: "Profil", href: "/profile", icon: User },
  ];

  // "Cevapla" sekmesi aktif mi? (/questions ile başlıyorsa)
  const isAnswerTabActive = pathname === "/questions";

  return (
    <>
      {/* 1. ÖZEL AKSİYON ÇUBUĞU (Sadece Cevapla sekmesinde görünür) */}
      {isAnswerTabActive && (
        <div className="fixed bottom-[5.5rem] left-4 right-4 z-50 animate-bounce-slight">
           <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-2xl p-2 flex border border-gray-100 ring-1 ring-black/5">
              
              {/* Sol Buton: Sorularım */}
              <Link href="/my-questions" className="flex-1 group flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-orange-50 to-orange-100/50 rounded-xl mr-2 active:scale-95 transition-all relative overflow-hidden">
                 <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500"></div>
                 <div className="bg-white p-2 rounded-full shadow-sm text-orange-500">
                    <HelpCircle size={20} />
                 </div>
                 <span className="font-bold text-gray-700 text-sm">Sorularım</span>
              </Link>
              
              <div className="w-[1px] bg-gray-200 my-2"></div>
              
              {/* Sağ Buton: Cevaplarım */}
              <Link href="/my-answers" className="flex-1 group flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-blue-50 to-blue-100/50 rounded-xl ml-2 active:scale-95 transition-all relative overflow-hidden">
                 <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500"></div>
                 <div className="bg-white p-2 rounded-full shadow-sm text-blue-500">
                    <PenTool size={20} />
                 </div>
                 <span className="font-bold text-gray-700 text-sm">Cevaplarım</span>
              </Link>
           </div>
        </div>
      )}

      {/* 2. ANA BOTTOM NAVIGATION BAR */}
      {/* Lexwoow seçiliyken arkaya hafif glow efekti ekliyoruz */}
      <nav className={cn(
          "fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 pb-safe shadow-[0_-5px_20px_rgba(0,0,0,0.03)] transition-all duration-500",
          pathname === "/lexwoow" && "shadow-[0_-10px_40px_rgba(255,107,107,0.2)]"
        )}>
        <div className="flex justify-around items-end h-[65px] px-1 pb-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            // LEXWOOW ÖZEL TASARIMI
            if (item.isSpecial) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-col items-center justify-end w-full relative mb-1"
                >
                  <div className={cn(
                    "transition-all duration-300 p-3 rounded-2xl mb-1 flex items-center justify-center",
                    isActive 
                      ? "bg-gradient-to-tr from-lexwoow-start to-lexwoow-end shadow-lg shadow-orange-200 -translate-y-4 scale-110" 
                      : "bg-gray-50"
                  )}>
                    <Icon 
                      size={24} 
                      className={isActive ? "text-white animate-pulse" : "text-gray-400"} 
                    />
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold transition-colors absolute bottom-0",
                     isActive ? "text-transparent bg-clip-text bg-gradient-to-r from-lexwoow-start to-lexwoow-end" : "text-gray-400"
                  )}>
                    {item.label}
                  </span>
                </Link>
              );
            }

            // STANDART İKONLAR
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center w-full h-full pb-1 group"
              >
                <Icon 
                    size={24} 
                    className={cn(
                        "transition-all duration-300 mb-1", 
                        isActive ? "text-lexwoow-start -translate-y-1" : "text-gray-400 group-hover:text-gray-600"
                    )} 
                />
                <span className={cn(
                    "text-[10px] transition-all", 
                    isActive ? "font-bold text-lexwoow-start" : "font-medium text-gray-400"
                )}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}