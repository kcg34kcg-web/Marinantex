'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import {
  Briefcase,
  LayoutDashboard,
  Users,
  Scale,
  PanelLeftClose,
  PanelLeftOpen,
  Calculator,
  Building2,
  UserPlus,
  UserCircle2,
  BrainCircuit,
  Sparkles,
} from 'lucide-react';
import { useUiStore } from '@/store/ui-store';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';

// ── Hick Kanunu: Düz liste yerine anlam grupları ─────────────────────────────────────────
// Karar yorgunluğunu (decision fatigue) önlemek için 3 grup: 4 + 3 + 3 madde
const NAV_GROUPS = [
  {
    label: 'Çalışma Alanı',
    items: [
      { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
      { href: '/dashboard/cases', label: 'Dosyalar', icon: Briefcase },
      { href: '/dashboard/clients', label: 'Müvekkiller', icon: Users },
      { href: '/office', label: 'Ofisim', icon: Building2 },
    ],
  },
  {
    label: 'Yapay Zeka',
    items: [{ href: '/tools/hukuk-ai', label: 'Hukuk AI', icon: BrainCircuit }],
  },
  {
    label: 'Araçlar',
    items: [
      { href: '/tools/calculator/interest', label: 'Faiz', icon: Calculator },
      { href: '/tools/calculator/smm', label: 'SMM', icon: Calculator },
      { href: '/tools/calculator/execution', label: 'İcra', icon: Calculator },
    ],
  },
  {
    label: 'Yönetim',
    items: [
      { href: '/dashboard/profile', label: 'Profil', icon: UserCircle2 },
      { href: '/dashboard/invites', label: 'Davetler', icon: UserPlus },
    ],
  },
] as const;

export function DashboardSidebar() {
  const { isSidebarOpen, toggleSidebar } = useUiStore();
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-[var(--color-legal-border)] transition-all duration-300 ease-out',
        // Light: Deep Navy, Dark: ısıtma katmanı, Sepia: parşömen
        'bg-[var(--color-legal-surface)]',
        isSidebarOpen ? 'w-64' : 'w-[72px]',
      )}
    >
      {/* ── Logo alanı ───────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex h-16 items-center border-b border-[var(--color-legal-border)]',
          isSidebarOpen ? 'justify-between px-4' : 'justify-center',
        )}
      >
        {/* Babylexit logosu — Playfair Display Serif */}
        <div className={cn('flex items-center gap-2.5', !isSidebarOpen && 'hidden')}>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-legal-action)]">
            <Scale className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="font-serif text-sm font-bold leading-tight text-[var(--color-legal-primary)]">Babylexit</p>
            <p className="text-[9px] text-[var(--color-legal-text-secondary,_var(--muted-foreground))] leading-tight">
              Hukuk İşlet. Sistemi
            </p>
          </div>
        </div>

        {/* Scale ikonu — sadece daraltılmış modda */}
        {!isSidebarOpen && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-legal-action)]">
            <Scale className="h-4 w-4 text-white" />
          </div>
        )}

        {/* Daralt/genişlet */}
        <button
          onClick={toggleSidebar}
          title={isSidebarOpen ? 'Kenar çubuğunu daralt' : 'Kenar çubuğunu genişlet'}
          className={cn(
            'flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg',
            'text-[var(--color-legal-text-secondary,_var(--muted-foreground))]',
            'hover:bg-[var(--color-legal-bg)] dark:hover:bg-slate-800',
            'transition-colors duration-200',
            !isSidebarOpen && 'hidden',
          )}
        >
          {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
      </div>

      {/* ── Navigasyon ───────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-1">
            {/* Grup başlığı — daraltılmışta gizlenir */}
            {isSidebarOpen && (
              <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-legal-text-secondary,_var(--muted-foreground))]">
                {group.label}
              </p>
            )}

            {group.items.map((item) => {
              const Icon = item.icon;
              // Aktif durum: tam eşleşme veya alt-rota
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  title={!isSidebarOpen ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-150',
                    isSidebarOpen ? 'mx-2 rounded-xl' : 'mx-auto w-12 justify-center rounded-xl',
                    isActive
                      ? [
                          // Aktif: Royal Blue soluk arkaplan + sağ kenarda çizgi göstergesi
                          'bg-[var(--color-legal-action)]/10 text-[var(--color-legal-action)] font-medium',
                          isSidebarOpen && 'border-r-2 border-[var(--color-legal-action)]',
                        ]
                      : 'text-[var(--color-legal-text-secondary,_var(--muted-foreground))] hover:bg-[var(--color-legal-bg)] hover:text-[var(--color-legal-primary)] dark:hover:bg-slate-800',
                  )}
                >
                  <Icon className={cn('flex-shrink-0', isSidebarOpen ? 'h-4 w-4' : 'h-5 w-5')} />
                  {isSidebarOpen && <span className="truncate">{item.label}</span>}

                  {/* Yapay Zeka grubu için spark rozeti */}
                  {isSidebarOpen && group.label === 'Yapay Zeka' && (
                    <Sparkles className="ml-auto h-3 w-3 text-[var(--color-legal-accent)] opacity-70" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Alt alan: tema toggle ─────────────────────────────────────────── */}
      <div
        className={cn(
          'border-t border-[var(--color-legal-border)] p-3',
          isSidebarOpen ? 'flex items-center justify-between' : 'flex flex-col items-center gap-2',
        )}
      >
        {isSidebarOpen ? <ThemeToggle /> : <ThemeToggle compact />}
      </div>
    </aside>
  );
}
