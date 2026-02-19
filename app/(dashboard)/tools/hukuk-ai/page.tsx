import { HukukAiChat } from '@/components/tools/hukuk-ai-chat';

export const metadata = {
  title: 'Hukuk AI Araştırması | Babylexit',
  description: 'Sıfır Halüsinasyonlu Zero-Trust Türk Hukuku RAG Sistemi',
};

export default function HukukAiPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Hukuk AI Araştırması</h1>
        <p className="text-sm text-slate-500">
          Sıfır Halüsinasyonlu (Zero-Trust) · Çok Kiracılı · Maliyet Optimize Edilmiş · Türk Hukuku RAG v2.1
        </p>
      </div>
      <HukukAiChat />
    </div>
  );
}
