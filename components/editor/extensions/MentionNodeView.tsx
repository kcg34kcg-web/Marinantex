// components/editor/extensions/MentionNodeView.tsx
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@radix-ui/react-hover-card';
import { BookOpen, PlusCircle } from 'lucide-react';
import { LAW_DATA } from '@/lib/laws'; 

export default function MentionNodeView(props: NodeViewProps) {
  // Etiketin içindeki ID'yi al (örn: "tbk-117")
  const lawId = props.node.attrs.id;
  const label = props.node.attrs.label || lawId;

  // Veritabanından ilgili kanunu bul
  const law = LAW_DATA.find((l) => l.id === lawId);

  // "Metne Ekle" fonksiyonu
  const insertText = () => {
    if (!law) return;
    
    // 1. getPos fonksiyonunu güvenli bir değişkene al
    const getPos = props.getPos;
    
    // 2. Pozisyonu al (Fonksiyon mu diye kontrol et)
    const currentPos = typeof getPos === 'function' ? getPos() : 0;

    // 3. Eğer pozisyon sayı değilse (Tiptap bazen boolean döner) işlemi durdur
    if (typeof currentPos !== 'number') return;

    // 4. Mention'ın bittiği yeri hesapla (Başlangıç + Uzunluk)
    const endPos = currentPos + props.node.nodeSize;
      
    props.editor.chain()
      .focus()
      // Artık 'endPos' tanımlı olduğu için hata vermez
      .insertContentAt(endPos, `\n\n"${law.text}" (${law.label})\n`)
      .run();
  };

  return (
    <NodeViewWrapper className="inline-block mx-1 align-middle">
      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <span className="cursor-pointer bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-sm font-medium hover:bg-amber-200 transition-colors flex items-center gap-1 inline-flex">
            <BookOpen size={12} className="opacity-50" />
            {label}
          </span>
        </HoverCardTrigger>
        
        <HoverCardContent 
            className="w-80 bg-slate-900 border border-slate-700 text-slate-200 p-4 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-200" 
            sideOffset={5}
        >
          {law ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                <h4 className="font-bold text-amber-500 text-sm">{law.label}</h4>
              </div>
              <p className="text-sm leading-relaxed text-slate-300 italic">
                "{law.text}"
              </p>
              <button 
                onClick={insertText}
                className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded-lg text-xs font-bold transition-colors"
              >
                <PlusCircle size={14} />
                Metne Ekle
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Kanun metni bulunamadı.</p>
          )}
        </HoverCardContent>
      </HoverCard>
    </NodeViewWrapper>
  );
}