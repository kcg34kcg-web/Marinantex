// components/editor/EditorToolbar.tsx
import { 
  Bold, Italic, Underline as UnderlineIcon, List, 
  ListOrdered, Undo, Redo, Save, FileText, Copy, Check, 
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Maximize2, Minimize2, Scissors, Wand2, Highlighter, Palette, ChevronDown, Quote, Grid3X3, Trash2, Plus, SplitSquareHorizontal, SplitSquareVertical
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { exportToDocx } from '@/utils/docxExport';
import { saveAsLexge } from '@/utils/lexgeConverter';
import { copyToClipboardMultiMime } from '@/utils/uyapHelper';

const PRESET_TEXT_COLORS = ['#000000', '#475569', '#DC2626', '#ea580c', '#d97706', '#16a34a', '#2563eb', '#4f46e5', '#db2777', '#ffffff'];
const PRESET_HIGHLIGHT_COLORS = ['#fef08a', '#fde047', '#bbf7d0', '#86efac', '#bfdbfe', '#93c5fd', '#fbcfe8', '#f9a8d4', '#fed7aa', '#e5e7eb'];

interface ToolbarButtonProps {
  onClick: () => void;
  isActive: boolean;
  icon: any; 
  title?: string;
  iconColor?: string;
}

const ToolbarButton = ({ onClick, isActive, icon: Icon, title, iconColor }: ToolbarButtonProps) => (
  <button onClick={onClick} title={title} type="button"
    className={`p-2 rounded-md transition-colors flex items-center justify-center ${
      isActive ? 'bg-orange-100 text-orange-600 shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-orange-600'
    }`}
  >
    <Icon size={18} color={iconColor} />
  </button>
);

export const EditorToolbar = ({ editor, isFullscreen, setIsFullscreen }: { editor: any, isFullscreen: boolean, setIsFullscreen: (val: boolean) => void }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [showTextColorMenu, setShowTextColorMenu] = useState(false);
  const [showHighlightMenu, setShowHighlightMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  
  const textColorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Dışarı tıklayınca menüleri kapatma
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (textColorRef.current && !textColorRef.current.contains(target)) setShowTextColorMenu(false);
      if (highlightRef.current && !highlightRef.current.contains(target)) setShowHighlightMenu(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) setShowMoreMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!editor) return null;

  // --- FONKSİYONLAR ---
  const handleCopyForUyap = async () => {
    const success = await copyToClipboardMultiMime(editor);
    if (success) { setIsCopied(true); setTimeout(() => setIsCopied(false), 2500); toast.success("UYAP formatında kopyalandı!"); } 
    else toast.error("Kopyalama hatası.");
  };

  const handleWordExport = () => { exportToDocx(editor.getHTML()); toast.success("Word dosyası indiriliyor..."); };
  const insertPageBreak = () => { editor.chain().focus().setHorizontalRule().insertContent('<p></p>').run(); toast.success("Sayfa Sonu Eklendi"); setShowMoreMenu(false); };

  const handleInsertFootnote = () => {
    const note = prompt("Dipnot açıklamasını giriniz (Üzerine gelindiğinde görünür):");
    if (note) {
      editor.chain().focus().insertFootnote(note).run();
      toast.success("Dipnot eklendi!");
    }
    setShowMoreMenu(false);
  };

  const autoFormatPages = () => {
    const toastId = toast.loading("Sayfa sınırları hesaplanıyor...");
    let tr = editor.state.tr;
    let hrPositions: number[] = [];
    editor.state.doc.descendants((node: any, pos: number) => { if (node.type.name === 'horizontalRule') hrPositions.push(pos); });
    if (hrPositions.length > 0) { hrPositions.reverse().forEach((pos: number) => tr.delete(pos, pos + 1)); editor.view.dispatch(tr); }
    
    setTimeout(() => {
      const MAX_PAGE_HEIGHT = 930; 
      let currentHeight = 0;
      let positionsToBreak: number[] = [];
      editor.state.doc.forEach((node: any, offset: number) => {
         const domNode = editor.view.nodeDOM(offset) as HTMLElement;
         if (domNode && domNode.nodeType === 1) { 
            const style = window.getComputedStyle(domNode);
            const height = domNode.offsetHeight + parseFloat(style.marginBottom || '0') + parseFloat(style.marginTop || '0');
            if (currentHeight + height > MAX_PAGE_HEIGHT) { positionsToBreak.push(offset); currentHeight = height; } 
            else currentHeight += height;
         }
      });
      if (positionsToBreak.length === 0) { toast.success("Dilekçe 1 sayfa olarak düzenlendi.", { id: toastId }); return; }
      let chain = editor.chain();
      positionsToBreak.reverse().forEach((p) => { chain = chain.insertContentAt(p, { type: 'horizontalRule' }); });
      chain.run();
      toast.success(`Metin toplam ${positionsToBreak.length + 1} sayfaya otomatik bölündü!`, { id: toastId });
    }, 150);
    setShowMoreMenu(false);
  };

  return (
    <div className="flex flex-wrap items-center justify-between p-2 bg-white border border-slate-200 rounded-xl shadow-sm mb-4 shrink-0 gap-y-2 relative">
      
      {/* SOL GRUP: BİÇİMLENDİRME */}
      <div className="flex items-center gap-1 flex-wrap">
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} isActive={false} icon={Undo} title="Geri Al" />
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} isActive={false} icon={Redo} title="İleri Al" />
        <div className="w-px h-6 bg-slate-200 mx-1" />
        
        <select
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          value={editor.getAttributes('textStyle').fontFamily || '"Times New Roman", Times, serif'}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-slate-50 text-slate-700 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 font-medium cursor-pointer"
        >
          <option value='"Times New Roman", Times, serif'>Times New Roman</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value='"Calibri", sans-serif'>Calibri</option>
          <option value="Verdana, sans-serif">Verdana</option>
          <option value="Tahoma, sans-serif">Tahoma</option>
          <option value="Georgia, serif">Georgia</option>
        </select>
        <div className="w-px h-6 bg-slate-200 mx-1" />

        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} icon={Bold} title="Kalın" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} icon={Italic} title="İtalik" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} icon={UnderlineIcon} title="Altı Çizili" />
        
        <div className="w-px h-6 bg-slate-200 mx-1" />

        {/* RENK PALETLERİ */}
        <div className="flex items-center gap-1">
          <div className="relative" ref={highlightRef}>
            <button onClick={() => setShowHighlightMenu(!showHighlightMenu)} className={`flex items-center gap-0.5 p-1.5 rounded-md transition-colors ${editor.isActive('highlight') ? 'bg-yellow-100 text-yellow-700' : 'hover:bg-slate-100 text-slate-600'}`}>
              <Highlighter size={18} color={editor.getAttributes('highlight').color || '#eab308'} />
              <ChevronDown size={12} className="opacity-50" />
            </button>
            {showHighlightMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 shadow-xl rounded-lg p-2 z-50 w-40">
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase">Hazır Renkler</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {PRESET_HIGHLIGHT_COLORS.map(color => (
                    <button key={color} onClick={() => { editor.chain().focus().toggleHighlight({ color }).run(); setShowHighlightMenu(false); }} className="w-6 h-6 rounded-md border border-slate-200 hover:scale-110 transition-transform" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <div className="text-[10px] font-bold text-slate-400 mb-1 uppercase mt-2 border-t pt-2">Özel Renk Seç</div>
                <input type="color" onInput={(e) => { editor.chain().focus().toggleHighlight({ color: (e.target as HTMLInputElement).value }).run(); }} className="w-full h-8 cursor-pointer rounded border-0 p-0" />
              </div>
            )}
          </div>

          <div className="relative" ref={textColorRef}>
            <button onClick={() => setShowTextColorMenu(!showTextColorMenu)} className="flex items-center gap-0.5 p-1.5 rounded-md transition-colors hover:bg-slate-100 text-slate-600">
              <Palette size={18} color={editor.getAttributes('textStyle').color || '#000000'} />
              <ChevronDown size={12} className="opacity-50" />
            </button>
            {showTextColorMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 shadow-xl rounded-lg p-2 z-50 w-40">
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase">Hazır Renkler</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {PRESET_TEXT_COLORS.map(color => (
                    <button key={color} onClick={() => { editor.chain().focus().setColor(color).run(); setShowTextColorMenu(false); }} className="w-6 h-6 rounded-md border border-slate-200 hover:scale-110 transition-transform" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <button onClick={() => { editor.chain().focus().unsetColor().run(); setShowTextColorMenu(false); }} className="text-[10px] w-full p-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-medium">Rengi Sıfırla</button>
                <div className="text-[10px] font-bold text-slate-400 mb-1 uppercase mt-2 border-t pt-2">Özel Renk Seç</div>
                <input type="color" onInput={(e) => { editor.chain().focus().setColor((e.target as HTMLInputElement).value).run(); }} className="w-full h-8 cursor-pointer rounded border-0 p-0" />
              </div>
            )}
          </div>
        </div>

        <div className="w-px h-6 bg-slate-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} icon={AlignLeft} />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} icon={AlignCenter} />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} isActive={editor.isActive({ textAlign: 'justify' })} icon={AlignJustify} />
        <div className="w-px h-6 bg-slate-200 mx-1 hidden md:block" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} icon={List} />
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} icon={ListOrdered} />
        
        <div className="w-px h-6 bg-slate-200 mx-1 hidden sm:block" />

        {/* EKLE MENÜSÜ */}
        <div className="relative ml-2" ref={moreMenuRef}>
          <button 
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
          >
            <Plus size={14} /> Ekle <ChevronDown size={14} />
          </button>

          {showMoreMenu && (
            <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 shadow-xl rounded-lg p-1 z-50 flex flex-col gap-1">
              <div className="text-[10px] font-bold text-slate-400 px-2 pt-1 uppercase">Sayfa & Araçlar</div>
              <button onClick={insertPageBreak} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md text-left"><Scissors size={14}/> Manuel Sayfa Sonu</button>
              <button onClick={autoFormatPages} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md text-left"><Wand2 size={14}/> Otomatik Sayfala</button>
              <button onClick={handleInsertFootnote} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md text-left"><Quote size={14}/> Dipnot Ekle</button>
              
              <div className="text-[10px] font-bold text-slate-400 px-2 pt-2 uppercase border-t mt-1">Tablo İşlemleri</div>
              <button onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setShowMoreMenu(false); }} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md text-left"><Grid3X3 size={14}/> Yeni Tablo Ekle</button>
              {editor.isActive('table') && (
                <>
                  <button onClick={() => { editor.chain().focus().addRowAfter().run(); setShowMoreMenu(false); }} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md text-left"><SplitSquareHorizontal size={14}/> Alta Satır Ekle</button>
                  <button onClick={() => { editor.chain().focus().addColumnAfter().run(); setShowMoreMenu(false); }} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-md text-left"><SplitSquareVertical size={14}/> Sağa Sütun Ekle</button>
                  <button onClick={() => { editor.chain().focus().deleteTable().run(); setShowMoreMenu(false); }} className="flex items-center gap-2 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md text-left"><Trash2 size={14}/> Tabloyu Sil</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SAĞ GRUP: DIŞA AKTARMA VE TAM EKRAN */}
      <div className="flex items-center gap-1 border-l border-slate-200 pl-2 ml-auto">
        <button onClick={() => saveAsLexge(editor.getJSON())} className="p-2 text-slate-500 hover:text-orange-600 hover:bg-orange-50 rounded-md transition-colors" title="Taslağı Sakla"><Save size={16} /></button>
        <button onClick={handleWordExport} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Word Olarak İndir"><FileText size={16} /></button>
        <button onClick={handleCopyForUyap} className={`flex items-center gap-1.5 px-3 py-1.5 ml-1 rounded-md text-xs font-bold transition-all shadow-sm ${isCopied ? 'bg-emerald-500 text-white' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
          {isCopied ? <Check size={14} /> : <Copy size={14} />} <span className="hidden sm:inline">UYAP</span>
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={() => setIsFullscreen(!isFullscreen)} className="flex items-center gap-1 p-2 text-slate-500 hover:bg-slate-100 rounded-md transition-colors" title="Tam Ekran">
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
};