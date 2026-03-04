'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, ArrowRight, BookOpen } from 'lucide-react';

const FACTS = [
  { category: "Tarih", text: "Dünyanın bilinen en eski yazılı yasaları, M.Ö. 1754 civarında Babil Kralı Hammurabi tarafından oluşturulmuştur." },
  { category: "Medeni Hukuk", text: "Türk Medeni Kanunu, 1926 yılında İsviçre Medeni Kanunu örnek alınarak hazırlanmıştır." },
  { category: "İlginç", text: "Eski Roma'da, bir baba ailesindeki herkesi köle olarak satma hakkına sahipti. Neyse ki bu değişti!" },
  { category: "Ceza Hukuku", text: "'Masumiyet Karinesi', bir kişinin suçu kanıtlanana kadar masum sayılacağını ifade eden evrensel bir ilkedir." },
  { category: "Terimler", text: "'Mücbir Sebep', önceden öngörülemeyen ve önlenemeyen doğa olaylarını (deprem, sel gibi) ifade eder." },
];

export default function TriviaCard() {
  const [index, setIndex] = useState(0);

  const nextFact = () => {
    setIndex((prev) => (prev + 1) % FACTS.length);
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className="relative w-full max-w-md bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 shadow-2xl overflow-hidden">
        
        {/* Dekoratif Arka Plan */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/20 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

        <div className="flex items-center gap-3 mb-6 text-yellow-400">
          <Lightbulb className="fill-yellow-400/20" size={28} />
          <span className="font-bold tracking-widest uppercase text-sm">Bunları Biliyor muydunuz?</span>
        </div>

        <AnimatePresence mode='wait'>
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="min-h-[160px] flex flex-col justify-center"
          >
            <span className="text-xs font-bold text-indigo-300 mb-2 bg-indigo-950/50 px-2 py-1 rounded w-fit">
              {FACTS[index].category}
            </span>
            <p className="text-xl md:text-2xl font-medium text-slate-100 leading-relaxed">
              "{FACTS[index].text}"
            </p>
          </motion.div>
        </AnimatePresence>

        <button 
          onClick={nextFact}
          className="mt-6 flex items-center gap-2 text-sm font-bold text-white/60 hover:text-white transition-colors group"
        >
          <BookOpen size={16} />
          <span>Sıradaki Bilgi</span>
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  );
}