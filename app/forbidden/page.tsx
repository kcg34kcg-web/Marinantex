import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <ShieldAlert className="h-10 w-10 text-orange-500" />
      <h1 className="text-2xl font-semibold text-slate-900">Bu sayfaya erişim yetkiniz bulunmuyor</h1>
      <p className="text-slate-600">Lütfen yetkili bir kullanıcı hesabı ile giriş yapın.</p>
      <Link href="/login?switch=1">
        <Button variant="accent">Giriş Sayfasına Dön</Button>
      </Link>
    </main>
  );
}
