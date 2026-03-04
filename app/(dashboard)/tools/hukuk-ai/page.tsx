import { HukukAiChat } from '@/components/tools/hukuk-ai-chat';

export const metadata = {
  title: 'Hukuk AI Araştırması | Babylexit',
  description: 'Sıfır Halüsinasyonlu Zero-Trust Türk Hukuku RAG Sistemi',
};

export default function HukukAiPage() {
  return <HukukAiChat />;
}
