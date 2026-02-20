'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Gavel, ChevronRight, Home } from 'lucide-react';
import { logoutAndRedirectAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { CommandPaletteTrigger } from '@/components/ui/command-palette';
import { cn } from '@/lib/utils';

// ── Ekmek kırıntısı yol haritası ─────────────────────────────────────────────────────
const ROUTE_MAP: Record<string, string> = {
  '/dashboard': 'Panel',
  '/dashboard/cases': 'Dosyalar',
  '/dashboard/clients': 'Müvekkiller',
  '/dashboard/profile': 'Profil',
  '/dashboard/invites': 'Davetler',
  '/office': 'Ofisim',
  '/tools/hukuk-ai': 'Hukuk AI',
  '/tools/calculator/interest': 'Faiz Hesaplayıcı',
  '/tools/calculator/smm': 'SMM Aracı',
  '/tools/calculator/execution': 'İcra Masrafı',
  '/portal': 'Müvekkil Portalı',
};

function useBreadcrumbs(): { label: string; href: string }[] {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];

  let accumulated = '';
  for (const seg of segments) {
    accumulated += '/' + seg;
    const label = ROUTE_MAP[accumulated];
    if (label) crumbs.push({ label, href: accumulated });
  }
  return crumbs;
}

export function DashboardHeader() {
  const breadcrumbs = useBreadcrumbs();
  const currentTitle = breadcrumbs.at(-1)?.label ?? 'Panel';

  return (
    <header
      className={cn(
        // Glassmorphism: arkaplan üstekte saydamlaşar — CoCounsel'da yok
        'sticky top-0 z-20 border-b border-[var(--color-legal-border)]',
        'bg-[var(--color-legal-surface)]/80 backdrop-blur-xl',
        'px-6 py-3',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Sol: Ekmek kırıntısı + başlık */}
        <div className="min-w-0 flex-1">
          {/* Breadcrumb: çok katmanlı yapıda kaybolma kaygısını sıfırlar */}
          {breadcrumbs.length > 1 && (
            <nav aria-label="Ekmek kırıntısı" className="mb-0.5 flex items-center gap-1">
              <Link
                href="/dashboard"
                className="flex items-center text-[10px] text-[var(--color-legal-text-secondary,_var(--muted-foreground))] hover:text-[var(--color-legal-action)] transition-colors"
              >
                <Home className="h-2.5 w-2.5" />
              </Link>
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.href} className="flex items-center gap-1">
                  <ChevronRight className="h-2.5 w-2.5 text-[var(--color-legal-text-secondary,_var(--muted-foreground))]" />
                  {i === breadcrumbs.length - 1 ? (
                    <span className="text-[10px] font-medium text-[var(--color-legal-primary)]">{crumb.label}</span>
                  ) : (
                    <Link
                      href={crumb.href as Route}
                      className="text-[10px] text-[var(--color-legal-text-secondary,_var(--muted-foreground))] hover:text-[var(--color-legal-action)] transition-colors"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* Sayfa başlığı: Playfair Display serif — hukuki otorite hissi */}
          <h1 className="truncate font-serif text-xl font-semibold leading-tight text-[var(--color-legal-primary)]">
            {currentTitle}
          </h1>
        </div>

        {/* Sağ: Arama + Rozet + Çıkış */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Evrensel arama — Ctrl+K */}
          <CommandPaletteTrigger />

          {/* Yetki rozeti */}
          <div className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-legal-accent)]/30 bg-[var(--color-legal-accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-legal-accent)]">
            <Gavel className="h-3.5 w-3.5" />
            Yetkili
          </div>

          {/* Çıkış — mevcut action korundu */}
          <form action={logoutAndRedirectAction}>
            <Button type="submit" variant="outline" size="sm">
              Çıkış
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
