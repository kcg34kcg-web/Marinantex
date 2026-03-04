import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Living Lounge | Babylexit',
  description: 'Yapay zeka analiziniz hazırlanırken bekleyiniz.',
};

export default function LoungeLayout({ children }: { children: React.ReactNode }) {
  return children;
}