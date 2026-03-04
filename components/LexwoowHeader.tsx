"use client";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LexwoowHeader() {
  const router = useRouter();
  
  return (
    <div className="flex items-center gap-3">
      <button onClick={() => router.push('/')} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600">
        <ArrowLeft size={22} />
      </button>
      
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="text-2xl font-serif font-bold tracking-tighter text-slate-800">
          LEX<motion.span 
            initial={{ opacity: 0, scale: 2 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
            className="text-amber-600"
          >WOOW</motion.span>
        </h1>
      </motion.div>
    </div>
  );
}