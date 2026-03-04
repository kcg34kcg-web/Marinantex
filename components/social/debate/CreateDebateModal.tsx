'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2, Gavel, Plus } from "lucide-react";
import { useState, useTransition } from "react";
// HATA GİDERİLDİ: use-toast yerine react-hot-toast import edildi
import toast from 'react-hot-toast'; 
import { cn } from "@/utils/cn";
import { motion, AnimatePresence } from "framer-motion";

// Server Actions
import { createDebate, generateSmartTitles } from "@/app/actions/debate";

interface CreateDebateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

const CATEGORIES = [
  { id: 'general', label: 'Genel Gündem', icon: '🌍' },
  { id: 'politics', label: 'Siyaset', icon: '🏛️' },
  { id: 'technology', label: 'Teknoloji & AI', icon: '🤖' },
  { id: 'law', label: 'Hukuk & Adalet', icon: '⚖️' },
  { id: 'economy', label: 'Ekonomi', icon: '💰' },
  { id: 'sports', label: 'Spor', icon: '⚽' },
];

export default function CreateDebateModal({ isOpen, onClose, onCreated }: CreateDebateModalProps) {
  // HATA GİDERİLDİ: const { toast } = useToast(); satırı kaldırıldı
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  
  // AI State
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([]);

  // --- AI BAŞLIK ÖNERİSİ ---
  const handleGenerateTitles = async () => {
    const topicBase = title || description;
    if (topicBase.length < 3) {
      // GÜNCELLENDİ: react-hot-toast kullanımı
      toast.error("Konu Eksik: AI'ın çalışması için en azından konuyu kısaca yazmalısın.");
      return;
    }

    setIsGenerating(true);
    try {
      const titles = await generateSmartTitles(topicBase);
      setGeneratedTitles(titles);
      // GÜNCELLENDİ: react-hot-toast kullanımı
      toast.success("AI Başlıklar Hazır! İlgi çekici bir tanesini seçebilirsin.");
    } catch (error) {
      toast.error("Hata: Başlık üretilemedi.");
    } finally {
      setIsGenerating(false);
    }
  };

  // --- OLUŞTURMA İŞLEMİ ---
  const handleCreate = () => {
    if (!title || !description) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('category', category);

      const result = await createDebate(formData);

      if (result.success) {
        // GÜNCELLENDİ: react-hot-toast kullanımı
        toast.success("Münazara Başlatıldı! Topluluk şimdi fikirlerini tartışabilir.");
        
        setTitle("");
        setDescription("");
        setCategory("general");
        setGeneratedTitles([]);
        
        if (onCreated) onCreated();
        onClose();
      } else {
        toast.error(result.error || "Münazara oluşturulamadı.");
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isPending && !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] bg-white border-slate-200 p-0 overflow-hidden gap-0">
        
        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-100 p-6 pb-4">
           <DialogHeader>
             <div className="flex items-center gap-3 mb-2">
               <div className="bg-indigo-100 p-2.5 rounded-xl">
                 <Gavel className="w-6 h-6 text-indigo-600" />
               </div>
               <DialogTitle className="text-xl font-black text-slate-800 tracking-tight">
                 Yeni Münazara Başlat
               </DialogTitle>
             </div>
             <DialogDescription className="text-slate-500 font-medium ml-1">
               Topluluğun fikrini merak ettiğin bir konu hakkında tartışma başlat.
             </DialogDescription>
           </DialogHeader>
        </div>

        {/* Form Content */}
        <div className="p-6 space-y-5">
           
           {/* Kategori Seçimi */}
           <div className="space-y-3">
              <Label className="text-xs font-bold uppercase text-slate-400 tracking-wider ml-1">Kategori</Label>
              <div className="grid grid-cols-3 gap-2">
                 {CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategory(cat.id)}
                      className={cn(
                        "flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-bold transition-all",
                        category === cat.id 
                          ? "bg-indigo-50 border-indigo-200 text-indigo-700 ring-1 ring-indigo-200" 
                          : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                       <span>{cat.icon}</span>
                       <span>{cat.label}</span>
                    </button>
                 ))}
              </div>
           </div>

           {/* Başlık Alanı */}
           <div className="space-y-2 relative">
              <div className="flex justify-between items-center px-1">
                 <Label className="text-sm font-bold text-slate-700">Tartışma Başlığı</Label>
                 <button 
                   onClick={handleGenerateTitles}
                   disabled={isGenerating || isPending}
                   className="text-[10px] font-bold text-purple-600 hover:text-purple-700 hover:bg-purple-50 px-2 py-1 rounded-full transition-colors flex items-center gap-1 disabled:opacity-50"
                 >
                    {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    AI ile Başlık Üret
                 </button>
              </div>
              
              <Input 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn: Yapay zeka avukatların yerini alabilir mi?"
                className="h-12 text-base font-semibold border-slate-200 focus-visible:ring-indigo-500/20"
                maxLength={100}
              />

              <AnimatePresence>
                {generatedTitles.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 p-3 bg-purple-50 rounded-xl border border-purple-100 space-y-2">
                       <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1 px-1">AI Önerileri</p>
                       {generatedTitles.map((t, i) => (
                          <button
                            key={i}
                            onClick={() => { setTitle(t); setGeneratedTitles([]); }}
                            className="block w-full text-left text-sm font-medium text-purple-900 bg-white/50 hover:bg-white p-2 rounded-lg border border-transparent hover:border-purple-200 transition-all"
                          >
                             {t}
                          </button>
                       ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
           </div>

           {/* Açıklama */}
           <div className="space-y-2">
              <Label className="text-sm font-bold text-slate-700 px-1">Detaylı Açıklama</Label>
              <Textarea 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="İnsanların konuyu daha iyi anlaması için bağlam ekle..."
                className="min-h-[120px] resize-none border-slate-200 focus-visible:ring-indigo-500/20 text-slate-600"
                maxLength={500}
              />
              <div className="flex justify-end">
                 <span className="text-[10px] text-slate-400">{description.length}/500</span>
              </div>
           </div>

        </div>

        {/* Footer */}
        <div className="p-6 pt-2 bg-white flex justify-end gap-3">
           <Button 
             variant="ghost" 
             onClick={onClose} 
             disabled={isPending}
             className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 font-bold"
           >
             Vazgeç
           </Button>
           <Button 
             onClick={handleCreate}
             disabled={!title || !description || isPending}
             className={cn(
                "bg-indigo-600 hover:bg-indigo-700 text-white px-6 font-bold transition-all shadow-lg shadow-indigo-200",
                isPending && "opacity-80 scale-95"
             )}
           >
             {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Oluşturuluyor...
                </>
             ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Tartışmayı Başlat
                </>
             )}
           </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}