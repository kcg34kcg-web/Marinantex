'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import {
  Briefcase,
  LayoutDashboard,
  CalendarDays,
  Wallet,
  Users,
  Scale,
  PanelLeftClose,
  PanelLeftOpen,
  Calculator,
  Building2,
  MessageSquare,
  FileText,
  UserPlus,
  UserCircle2,
  BrainCircuit,
  FileSignature,
  Sparkles,
  Library,
  Settings,
  Search,
  Newspaper,
} from 'lucide-react';
import { useUiStore } from '@/store/ui-store';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';

const NAV_GROUPS = [
  {
    label: 'Calisma Alani',
    items: [
      { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
      { href: '/dashboard/calendar', label: 'Takvim', icon: CalendarDays },
      { href: '/dashboard/cases', label: 'Dosyalar', icon: Briefcase },
      { href: '/dashboard/clients', label: 'Muvekkiller', icon: Users },
      { href: '/dashboard/time-billing', label: 'Zaman ve Tahsilat', icon: Wallet },
      { href: '/editor/local-demo-document', label: 'Belge Duzenleme', icon: FileText },
      { href: '/office', label: 'Ofisim', icon: Building2 },
      { href: '/social', label: 'Sosyal', icon: MessageSquare },
      { href: '/dashboard/news', label: 'Haberler', icon: Newspaper },
    ],
  },
  {
    label: 'Yapay Zeka',
    items: [
      { href: '/tools/hukuk-ai', label: 'Hukuk Asistani', icon: BrainCircuit },
      { href: '/tools/dilekce-sihirbazi', label: 'Dilekce Sihirbazi', icon: FileSignature },
      { href: '/tools/kaynak-ictihat-arama', label: 'Kaynak / Ictihat Arama', icon: Search },
    ],
  },
  {
    label: 'Araclar',
    items: [
      { href: '/tools/calculator/interest', label: 'Faiz', icon: Calculator },
      { href: '/tools/calculator/smm', label: 'SMM', icon: Calculator },
      { href: '/tools/calculator/execution', label: 'Icra', icon: Calculator },
    ],
  },
  {
    label: 'Yonetim',
    items: [
      { href: '/dashboard/profile', label: 'Profil', icon: UserCircle2 },
      { href: '/dashboard/settings', label: 'Ayarlar', icon: Settings },
      { href: '/dashboard/invites', label: 'Davetler', icon: UserPlus },
      { href: '/dashboard/corpus', label: 'Kaynak Havuzu', icon: Library },
    ],
  },
] as const;

export function DashboardSidebar() {
  const { isSidebarOpen, toggleSidebar } = useUiStore();
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'relative z-20 self-stretch shrink-0 border-r transition-[width] duration-300',
        'border-[var(--sidebar-border,var(--border))]',
        '[background:linear-gradient(180deg,var(--sidebar-bg-1,var(--surface))_0%,var(--sidebar-bg-2,color-mix(in_srgb,var(--surface),var(--bg)_20%))_100%)]',
        isSidebarOpen ? 'w-[var(--sidebar-width)]' : 'w-[var(--sidebar-collapsed-width)]',
      )}
    >
      <div className="app-glass-sidebar sticky top-0 relative flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden">
        {/* Dekoratif katmanlar */}
        <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(80%_40%_at_0%_0%,var(--sidebar-glow-1,color-mix(in_srgb,var(--primary),transparent_82%))_0%,transparent_60%),radial-gradient(70%_35%_at_100%_15%,var(--sidebar-glow-2,color-mix(in_srgb,var(--accent),transparent_86%))_0%,transparent_60%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 opacity-70 [background:linear-gradient(180deg,transparent_0%,color-mix(in_srgb,var(--sidebar-bg-2,var(--surface)),var(--primary)_8%)_100%)]" />

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div
          className={cn(
            'relative shrink-0 border-b border-[var(--sidebar-border,var(--border))]',
            'bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_5%)]/90 backdrop-blur-sm',
            isSidebarOpen ? 'h-16 px-[var(--sidebar-shell-padding)]' : 'h-20 px-2',
          )}
        >
          <div
            className={cn(
              'flex h-full items-center',
              isSidebarOpen ? 'justify-between' : 'flex-col justify-center gap-1',
            )}
          >
            <div className={cn('min-w-0', !isSidebarOpen && 'hidden')}>
              <div className="flex items-center gap-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),white_8%)] bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_8%)] px-2.5 py-2 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.35)]">
                <div className="relative flex h-9 w-9 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary),white_15%),var(--primary))] text-white shadow-[0_10px_24px_-16px_var(--primary)]">
                  <Scale className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-serif text-sm font-bold leading-tight text-[var(--sidebar-text,var(--text))]">
                    Babylexit
                  </p>
                  <p className="truncate text-[10px] leading-tight text-[var(--sidebar-muted,var(--secondary))]">
                    Hukuk Isletim Sistemi
                  </p>
                </div>
              </div>
            </div>

            {!isSidebarOpen ? (
              <div className="relative flex h-9 w-9 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary),white_15%),var(--primary))] text-white shadow-[0_10px_24px_-16px_var(--primary)]">
                <Scale className="h-4 w-4" />
              </div>
            ) : null}

            <button
              type="button"
              onClick={toggleSidebar}
              title={isSidebarOpen ? 'Kenar cubugunu daralt' : 'Kenar cubugunu genislet'}
              className={cn(
                'inline-flex items-center justify-center rounded-xl border transition-all duration-200',
                'border-[var(--sidebar-border,var(--border))]',
                'bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_6%)]',
                'text-[var(--sidebar-muted,var(--secondary))]',
                'hover:bg-[var(--sidebar-hover,color-mix(in_srgb,var(--surface),var(--primary)_8%))] hover:text-[var(--sidebar-text,var(--text))]',
                'shadow-[0_6px_20px_-16px_rgba(0,0,0,0.35)]',
                !isSidebarOpen ? 'min-h-[30px] min-w-[30px]' : 'min-h-[34px] min-w-[34px]',
              )}
            >
              {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* NAV */}
        <nav
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain py-3 pr-1 [scrollbar-gutter:stable]',
            isSidebarOpen ? 'pb-24' : 'pb-12',
          )}
        >
          {NAV_GROUPS.map((group) => (
            <section
              key={group.label}
              className={cn(
                'mb-3',
                isSidebarOpen
                  ? 'mx-2 rounded-2xl border border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),white_6%)] bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_4%)] p-1.5 shadow-[0_12px_24px_-22px_rgba(0,0,0,0.35)]'
                  : 'mx-1',
              )}
            >
              {isSidebarOpen ? (
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sidebar-muted,var(--secondary))]">
                  {group.label}
                </p>
              ) : null}

              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));

                  return (
                    <Link
                      key={item.href}
                      href={item.href as Route}
                      title={!isSidebarOpen ? item.label : undefined}
                      className={cn(
                        'group relative flex items-center overflow-hidden border transition-all duration-200',
                        isSidebarOpen
                          ? 'rounded-2xl px-[var(--sidebar-item-px)] py-[var(--sidebar-item-py)]'
                          : 'mx-auto h-12 w-12 justify-center rounded-2xl',
                        isActive
                          ? [
                              'border-[var(--sidebar-active-border,color-mix(in_srgb,var(--primary),white_20%))]',
                              'bg-[var(--sidebar-active-bg,color-mix(in_srgb,var(--primary),transparent_90%))]',
                              'text-[var(--sidebar-active-text,var(--primary))]',
                              'shadow-[0_10px_25px_-20px_var(--primary)]',
                            ]
                          : [
                              'border-transparent',
                              'text-[var(--sidebar-muted,var(--secondary))]',
                              'hover:border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),var(--primary)_18%)]',
                              'hover:bg-[var(--sidebar-hover,color-mix(in_srgb,var(--surface),var(--primary)_8%))]',
                              'hover:text-[var(--sidebar-text,var(--text))]',
                            ],
                      )}
                    >
                      {isSidebarOpen && (
                        <span
                          className={cn(
                            'pointer-events-none absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full transition-opacity',
                            isActive ? 'bg-[var(--primary)] opacity-100' : 'opacity-0',
                          )}
                        />
                      )}

                      <span
                        className={cn(
                          'pointer-events-none absolute inset-x-2 top-0 h-8 rounded-full blur-xl transition-opacity',
                          isActive
                            ? 'opacity-50 [background:radial-gradient(closest-side,var(--primary),transparent)]'
                            : 'opacity-0',
                        )}
                      />

                      <Icon
                        className={cn(
                          'relative z-[1] flex-shrink-0 transition-transform duration-200',
                          isSidebarOpen ? 'h-4 w-4' : 'h-5 w-5',
                          !isActive && 'group-hover:scale-[1.04]',
                        )}
                      />

                      {isSidebarOpen ? (
                        <span className="relative z-[1] truncate text-sm">{item.label}</span>
                      ) : null}

                      {isSidebarOpen && group.label === 'Yapay Zeka' ? (
                        <Sparkles className="relative z-[1] ml-auto h-3.5 w-3.5 text-[var(--accent)] opacity-90" />
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        {/* Footer / Theme Dock */}
        <div
          className={cn(
            'shrink-0 border-t border-[var(--sidebar-border,var(--border))]',
            'bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),var(--bg)_10%)]/95 backdrop-blur-sm',
            // collapsed modda footer iÃ§eriÄŸi merkezde
            isSidebarOpen ? 'p-3' : 'p-2 flex items-center justify-center',
          )}
        >
          <div
            className={cn(
              'rounded-2xl border border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),white_8%)]',
              'bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_6%)]',
              'shadow-[0_16px_30px_-24px_rgba(0,0,0,0.45)]',
              // collapsed modda sabit kare dock + tam merkez
              isSidebarOpen ? 'p-2.5' : 'h-14 w-14 p-0 flex items-center justify-center',
            )}
          >
            {isSidebarOpen ? (
              <ThemeToggle />
            ) : (
              <ThemeToggle
                compact
                className="grid h-10 w-10 min-h-[40px] min-w-[40px] place-items-center p-0 leading-none align-middle -translate-y-px"
              />
            )}
          </div>
        </div>
        </div>
      </div>
    </aside>
  );
}

