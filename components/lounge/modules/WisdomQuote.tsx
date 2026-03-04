'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RefreshCcw, Copy, CheckCircle2, Share2 } from 'lucide-react';
import { toast } from 'react-hot-toast'; // Eğer proje yapında toast varsa

// --- TİP TANIMLAMALARI ---
interface QuoteData {
  id: string;
  text: string;
  author: string;
  title?: string;
  era: string;
  tags: string[];
}

// --- GENİŞLETİLMİŞ VERİ HAVUZU (DATABASE) ---
// Hukuk, adalet, felsefe ve devlet yönetimi üzerine seçilmiş sözler.
const QUOTE_DATABASE: QuoteData[] = [
  {
    id: "q1",
    text: "Adalet mülkün temelidir.",
    author: "Mustafa Kemal Atatürk",
    title: "Türkiye Cumhuriyeti Kurucusu",
    era: "Cumhuriyet Dönemi",
    tags: ["Liderlik", "Adalet"]
  },
  {
    id: "q2",
    text: "Hukuk, aklın tutkudan arınmış halidir.",
    author: "Aristoteles",
    title: "Yunan Filozof",
    era: "Antik Yunan",
    tags: ["Felsefe", "Mantık"]
  },
  {
    id: "q3",
    text: "Bir suçlunun cezasız kalması, bir masumun mahkum olmasından iyidir.",
    author: "Roma Hukuku İlkesi",
    title: "In dubio pro reo",
    era: "Antik Roma",
    tags: ["Ceza Hukuku", "Prensip"]
  },
  {
    id: "q4",
    text: "Kanunlar örümcek ağı gibidir; küçük sinekler takılır, büyükler deler geçer.",
    author: "Honoré de Balzac",
    title: "Fransız Yazar",
    era: "19. Yüzyıl",
    tags: ["Eleştiri", "Toplum"]
  },
  {
    id: "q5",
    text: "Adaletsizliği işleyen, çekenden daha sefildir.",
    author: "Platon",
    title: "Yunan Filozof",
    era: "Antik Yunan",
    tags: ["Ahlak", "Felsefe"]
  },
  {
    id: "q6",
    text: "Yasama, yürütme ve yargı iç içe geçmişse, özgürlükten söz edilemez.",
    author: "Montesquieu",
    title: "Aydınlanma Çağı Düşünürü",
    era: "18. Yüzyıl",
    tags: ["Demokrasi", "Kuvvetler Ayrılığı"]
  },
  {
    id: "q7",
    text: "Geciken adalet, adalet değildir.",
    author: "Magna Carta",
    title: "Hukuk Belgesi",
    era: "1215",
    tags: ["Hukuk Tarihi", "Hak"]
  },
  {
    id: "q8",
    text: "En kötü barış, en haklı savaştan daha iyidir.",
    author: "Cicero",
    title: "Romalı Devlet Adamı",
    era: "M.Ö. 1. Yüzyıl",
    tags: ["Barış", "Diplomasi"]
  },
  {
    id: "q9",
    text: "Bir memlekette namuslular, namussuzlar kadar cesur olmadıkça, o memlekette kurtuluş yoktur.",
    author: "İsmet İnönü",
    title: "2. Cumhurbaşkanı",
    era: "Cumhuriyet Dönemi",
    tags: ["Cesaret", "Toplum"]
  },
  {
    id: "q10",
    text: "Özgürlük, başkalarına zarar vermeyen her şeyi yapabilmektir.",
    author: "İnsan Hakları Bildirgesi",
    title: "Madde 4",
    era: "1789",
    tags: ["İnsan Hakları", "Özgürlük"]
  },
  {
    id: "q11",
    text: "Hukuk, bir topluluğun ahlaki değerlerinin asgari müşterekidir.",
    author: "Georg Jellinek",
    title: "Hukukçu",
    era: "19. Yüzyıl",
    tags: ["Sosyoloji", "Teori"]
  },
  {
    id: "q12",
    text: "Ceza kaldırılabilir; ama suç insanın içinde sonsuza kadar yaşar.",
    author: "Ovidius",
    title: "Romalı Şair",
    era: "Antik Roma",
    tags: ["Vicdan", "Suç"]
  },
  {
    id: "q13",
    text: "Adalet kutup yıldızı gibi yerinde durur ve geri kalan her şey onun etrafında döner.",
    author: "Konfüçyüs",
    title: "Çinli Filozof",
    era: "M.Ö. 6. Yüzyıl",
    tags: ["Doğu Felsefesi", "Düzen"]
  },
  {
    id: "q14",
    text: "Bırakın adalet yerini bulsun, isterse kıyamet kopsun.",
    author: "Roma Atasözü",
    title: "Fiat justitia ruat caelum",
    era: "Klasik Dönem",
    tags: ["Keskinlik", "İlke"]
  },
  {
    id: "q15",
    text: "İnsanlar hükümetlerden korktuğu zaman tiranlık; hükümetler insanlardan korktuğu zaman özgürlük vardır.",
    author: "Thomas Jefferson",
    title: "ABD Kurucu Babası",
    era: "18. Yüzyıl",
    tags: ["Demokrasi", "Yönetim"]
  },
  {
    id: "q16",
    text: "Eşitlik olmadan adalet, adalet olmadan barış olmaz.",
    author: "Anonim",
    title: "Evrensel İlke",
    era: "Modern Çağ",
    tags: ["Eşitlik", "Barış"]
  },
  {
    id: "q17",
    text: "Suçluyu kazı, altından insan çıkar.",
    author: "Farid Yersel",
    title: "Hukukçu",
    era: "Modern Dönem",
    tags: ["Hümanizm", "Kriminoloji"]
  },
  {
    id: "q18",
    text: "Kanun ordudan daha güçlüdür.",
    author: "Yunan Atasözü",
    title: "Halk Deyişi",
    era: "Antik Çağ",
    tags: ["Sivil Toplum", "Güç"]
  },
  {
    id: "q19",
    text: "Haksızlık yapıp tüm insanlarla birlikte olmaktansa, adaletli davranıp tek başına kalmak daha iyidir.",
    author: "Mahatma Gandhi",
    title: "Hint Lider",
    era: "20. Yüzyıl",
    tags: ["Liderlik", "Erdem"]
  },
  {
    id: "q20",
    text: "Bir ulusun büyüklüğü ve ahlaki gelişimi, hayvanlara nasıl davrandığıyla değerlendirilebilir.",
    author: "Mahatma Gandhi",
    title: "Düşünür",
    era: "20. Yüzyıl",
    tags: ["Hayvan Hakları", "Vicdan"]
  },
  {
    id: "q21",
    text: "Hiçbir miras, doğruluk kadar zengin değildir.",
    author: "William Shakespeare",
    title: "İngiliz Şair",
    era: "16. Yüzyıl",
    tags: ["Edebiyat", "Dürüstlük"]
  },
  {
    id: "q22",
    text: "Adalet topaldır, ağır yürür fakat gideceği yere er geç varır.",
    author: "Mirabeau",
    title: "Fransız Devrimci",
    era: "18. Yüzyıl",
    tags: ["Umut", "Sabır"]
  },
  {
    id: "q23",
    text: "Devletin hazinesi adalettir.",
    author: "Hz. Ali",
    title: "İslam Halifesi",
    era: "7. Yüzyıl",
    tags: ["İslam Hukuku", "Devlet"]
  },
  {
    id: "q24",
    text: "Yasa, yoksulu ezer; zengini ise korur.",
    author: "Oliver Goldsmith",
    title: "İrlandalı Yazar",
    era: "18. Yüzyıl",
    tags: ["Eleştiri", "Sınıf Farkı"]
  },
  {
    id: "q25",
    text: "Toplumun en büyük düşmanı, yasaların uygulanmasındaki keyfiliktir.",
    author: "John Locke",
    title: "İngiliz Filozof",
    era: "17. Yüzyıl",
    tags: ["Liberalizm", "Hukuk Devleti"]
  }
];

// --- YARDIMCI BİLEŞEN: PARTİKÜL EFEKTİ ---
const FloatingParticles = () => {
  const particles = Array.from({ length: 20 });
  
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {particles.map((_, i) => (
        <motion.div
          key={i}
          className="absolute bg-indigo-200/10 rounded-full blur-[1px]"
          style={{
            width: Math.random() * 4 + 2 + 'px',
            height: Math.random() * 4 + 2 + 'px',
            top: Math.random() * 100 + '%',
            left: Math.random() * 100 + '%',
          }}
          animate={{
            y: [0, -120, 0], 
            x: [0, Math.random() * 60 - 30, 0], 
            opacity: [0, 0.4, 0],
            scale: [0.8, 1.2, 0.8]
          }}
          transition={{
            duration: Math.random() * 15 + 10,
            repeat: Infinity,
            ease: "easeInOut",
            delay: Math.random() * 5
          }}
        />
      ))}
    </div>
  );
};

// --- ANA BİLEŞEN ---
export default function WisdomQuote() {
  const [currentQuote, setCurrentQuote] = useState<QuoteData | null>(null);
  const [key, setKey] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  
  // Rastgele bir söz seç (Mevcut olandan farklı olmasını garanti et)
  const pickRandomQuote = useCallback(() => {
    setCurrentQuote((prev) => {
      let newQuote;
      do {
        const randomIndex = Math.floor(Math.random() * QUOTE_DATABASE.length);
        newQuote = QUOTE_DATABASE[randomIndex];
      } while (prev && newQuote.id === prev.id && QUOTE_DATABASE.length > 1);
      
      return newQuote;
    });
    setKey((k) => k + 1);
    setIsCopied(false);
  }, []);

  // İlk yüklemede rastgele bir söz getir
  useEffect(() => {
    pickRandomQuote();
  }, [pickRandomQuote]);

  // Kopyalama Fonksiyonu
  const handleCopy = async () => {
    if (!currentQuote) return;
    try {
      await navigator.clipboard.writeText(`"${currentQuote.text}" — ${currentQuote.author}`);
      setIsCopied(true);
      toast.success("Söz kopyalandı!");
      
      // 2 saniye sonra ikonu geri döndür
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Kopyalama başarısız", err);
    }
  };

  // Paylaşma Fonksiyonu (Web Share API)
  const handleShare = async () => {
    if (!currentQuote) return;
    const shareData = {
      title: 'Babylexit Bilgelik',
      text: `"${currentQuote.text}" — ${currentQuote.author}`,
      url: window.location.origin
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.log('Paylaşım iptal edildi');
      }
    } else {
      handleCopy(); // Tarayıcı desteklemiyorsa kopyala
    }
  };

  if (!currentQuote) return null; // Yükleniyor...

  return (
    <div className="w-full h-full min-h-[360px] relative overflow-hidden rounded-[2rem] bg-slate-900/40 border border-white/5 shadow-2xl flex flex-col items-center justify-center p-6 md:p-10 group">
      
      {/* 1. ATMOSFERİK ARKA PLAN */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 via-slate-900/50 to-black/40 pointer-events-none" />
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/3 pointer-events-none" />
      <FloatingParticles />
      
      {/* 2. İÇERİK ALANI */}
      <div className="relative z-10 w-full h-full flex flex-col justify-between">
        
        {/* Üst Kısım: Etiketler ve İkon */}
        <div className="flex justify-between items-start mb-4">
           <motion.div 
             key={`icon-${key}`}
             initial={{ scale: 0, rotate: -90 }}
             animate={{ scale: 1, rotate: 0 }}
             className="text-amber-300/80 bg-amber-500/10 p-2 rounded-xl border border-amber-500/20"
           >
             <Sparkles size={20} />
           </motion.div>

           <motion.div 
             key={`tags-${key}`}
             initial={{ opacity: 0, x: 20 }}
             animate={{ opacity: 1, x: 0 }}
             transition={{ delay: 0.3 }}
             className="flex gap-2"
           >
             {currentQuote.tags.map(tag => (
               <span key={tag} className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                 {tag}
               </span>
             ))}
           </motion.div>
        </div>

        {/* Orta Kısım: Söz */}
        <AnimatePresence mode='wait'>
          <motion.div 
            key={key}
            initial={{ opacity: 0, scale: 0.95, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(4px)' }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="flex-1 flex flex-col justify-center items-center text-center px-2"
          >
            <h2 className="text-xl md:text-3xl font-serif text-slate-100 leading-relaxed italic drop-shadow-sm">
              <span className="text-amber-500/40 text-3xl md:text-5xl font-sans mr-2 align-top">“</span>
              {currentQuote.text}
              <span className="text-amber-500/40 text-3xl md:text-5xl font-sans ml-2 align-bottom">”</span>
            </h2>
            
            <div className="w-12 h-0.5 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent my-6" />

            <div className="flex flex-col items-center gap-1">
              <span className="text-amber-400 font-bold tracking-widest text-sm uppercase">
                {currentQuote.author}
              </span>
              {currentQuote.title && (
                <span className="text-slate-400 text-xs font-medium">
                  {currentQuote.title}
                </span>
              )}
              <span className="text-slate-600 text-[10px] uppercase tracking-wider mt-1 border border-slate-700/50 rounded-full px-3 py-0.5">
                {currentQuote.era}
              </span>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Alt Kısım: Kontroller */}
        <div className="flex justify-between items-end mt-6 pt-4 border-t border-white/5">
           
           {/* Sol Taraf: Aksiyonlar */}
           <div className="flex gap-2">
              <button 
                onClick={handleCopy}
                className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-white/5 hover:border-white/20 active:scale-95"
                title="Kopyala"
              >
                {isCopied ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Copy size={16} />}
              </button>
              
              <button 
                onClick={handleShare}
                className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-white/5 hover:border-white/20 active:scale-95"
                title="Paylaş"
              >
                <Share2 size={16} />
              </button>
           </div>

           {/* Sağ Taraf: Sonraki */}
           <button 
             onClick={pickRandomQuote}
             className="group flex items-center gap-2 pl-4 pr-3 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all shadow-lg hover:shadow-indigo-500/25 active:scale-95"
           >
             <span>Yeni Söz</span>
             <RefreshCcw size={14} className="group-hover:rotate-180 transition-transform duration-700" />
           </button>

        </div>
      </div>
    </div>
  );
}