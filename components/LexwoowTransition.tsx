"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Gavel } from "lucide-react"; // Tokmak ikonu

export default function LexwoowTransition() {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center"
        >
          {/* Tokmak Animasyonu */}
          <motion.div
            initial={{ rotate: -45, y: -100 }}
            animate={{ rotate: 0, y: 0 }}
            transition={{ 
              type: "spring", 
              stiffness: 300, 
              damping: 15,
              delay: 0.2 
            }}
            className="text-amber-500"
          >
            <Gavel size={120} />
          </motion.div>

          {/* Tokmağın Vurduğu Andaki Şok Dalgası */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 2, opacity: [0, 0.5, 0] }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="absolute w-40 h-10 bg-amber-500/20 rounded-[100%] blur-xl"
          />

          <motion.h2
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-8 text-2xl font-serif font-bold tracking-[0.3em] text-slate-200"
          >
            LEXWOOW
          </motion.h2>
        </motion.div>
      )}
    </AnimatePresence>
  );
}