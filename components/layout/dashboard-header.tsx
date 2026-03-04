'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Gavel, ChevronRight, Home } from 'lucide-react';
import { logoutAndRedirectAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { CommandPaletteTrigger } from '@/components/ui/command-palette';
import { cn } from '@/lib/utils';

const ROUTE_MAP: Record<string, string> = {
  '/dashboard': 'Panel',
  '/dashboard/calendar': 'Takvim',
  '/dashboard/cases': 'Dosyalar',
  '/dashboard/clients': 'Muvekkiller',
  '/dashboard/time-billing': 'Zaman ve Tahsilat',
  '/dashboard/profile': 'Profil',
  '/dashboard/settings': 'Ayarlar',
  '/dashboard/invites': 'Davetler',
  '/dashboard/corpus': 'Corpus',
  '/office': 'Ofisim',
  '/tools/hukuk-ai': 'Hukuk AI',
  '/tools/kaynak-ictihat-arama': 'Kaynak / Ictihat Arama',
  '/tools/calculator/interest': 'Faiz Hesaplayici',
  '/tools/calculator/smm': 'SMM Araci',
  '/tools/calculator/execution': 'Icra Masrafi',
  '/portal': 'Muvekkil Portali',
};

function useBreadcrumbs(): { label: string; href: string }[] {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];

  let accumulated = '';
  for (const seg of segments) {
    accumulated += `/${seg}`;
    const label = ROUTE_MAP[accumulated];
    if (label) {
      crumbs.push({ label, href: accumulated });
    }
  }
  return crumbs;
}

export function DashboardHeader() {
  const breadcrumbs = useBreadcrumbs();
  const currentTitle = breadcrumbs.at(-1)?.label ?? 'Panel';

  return (
    <header
      className={cn(
        'app-glass-topbar sticky top-0 z-20 border-b border-[var(--main-border,var(--border))] px-6 py-3',
        'bg-[var(--main-surface-0,var(--surface))] backdrop-blur-[var(--blur-heavy)]',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {breadcrumbs.length > 1 ? (
            <nav aria-label="Breadcrumb" className="mb-0.5 flex items-center gap-1">
              <Link
                href="/dashboard"
                className="flex items-center text-[10px] text-[var(--secondary)] transition-colors hover:text-[var(--primary)]"
              >
                <Home className="h-2.5 w-2.5" />
              </Link>
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.href} className="flex items-center gap-1">
                  <ChevronRight className="h-2.5 w-2.5 text-[var(--secondary)]" />
                  {index === breadcrumbs.length - 1 ? (
                    <span className="text-[10px] font-medium text-[var(--text)]">{crumb.label}</span>
                  ) : (
                    <Link
                      href={crumb.href as Route}
                      className="text-[10px] text-[var(--secondary)] transition-colors hover:text-[var(--primary)]"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          ) : null}

          <h1 className="truncate font-serif text-xl font-semibold leading-tight text-[var(--text)]">{currentTitle}</h1>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <CommandPaletteTrigger />
          <div className="hidden items-center gap-1.5 rounded-xl border border-[color-mix(in_srgb,var(--accent),transparent_65%)] bg-[color-mix(in_srgb,var(--accent),transparent_88%)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] sm:inline-flex">
            <Gavel className="h-3.5 w-3.5" />
            Yetkili
          </div>
          <form action={logoutAndRedirectAction}>
            <Button type="submit" variant="outline" size="sm">
              Cikis
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
