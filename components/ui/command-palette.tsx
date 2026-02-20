'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  Search,
  LayoutDashboard,
  Briefcase,
  Calculator,
  BrainCircuit,
  Building2,
  Users,
  X,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Command Palette ─────────────────────────────────────────────────────────
// Evrensel navigasyon: Hick Kanunu azaltma — tüm sayfalara tek Ctrl+K ile
// Arama çubuğu: `backdrop-blur-xl bg-white/60 dark:bg-black/60 ring-1 ring-black/5 rounded-2xl`
// (Araştırma raporundaki birebir spesifikasyon)

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  href: string;
  icon: React.ElementType;
  group: string;
  keywords: string[];
}

const COMMAND_ITEMS: CommandItem[] = [
  {
    id: 'dashboard',
    label: 'Panel',
    description: 'Genel bakış ve günlük özet',
    href: '/dashboard',
    icon: LayoutDashboard,
    group: 'Çalışma Alanı',
    keywords: ['panel', 'özet', 'dashboard', 'ana sayfa'],
  },
  {
    id: 'cases',
    label: 'Dosyalar',
    description: 'Dava dosyaları ve belgeler',
    href: '/dashboard/cases',
    icon: Briefcase,
    group: 'Çalışma Alanı',
    keywords: ['dava', 'dosya', 'case', 'belge'],
  },
  {
    id: 'clients',
    label: 'Müvekkiller',
    description: 'Müvekkil listesi ve iletişim',
    href: '/dashboard/clients',
    icon: Users,
    group: 'Çalışma Alanı',
    keywords: ['müvekkil', 'client', 'müşteri'],
  },
  {
    id: 'office',
    label: 'Ofisim',
    description: 'Ofis yönetimi ve ekip',
    href: '/office',
    icon: Building2,
    group: 'Çalışma Alanı',
    keywords: ['ofis', 'ekip', 'büro'],
  },
  {
    id: 'hukuk-ai',
    label: 'Hukuk AI Araştırması',
    description: 'Sıfır Halüsinasyonlu RAG v2.1',
    href: '/tools/hukuk-ai',
    icon: BrainCircuit,
    group: 'Yapay Zeka',
    keywords: ['ai', 'yapay zeka', 'rag', 'araştırma', 'emsal', 'içtihat'],
  },
  {
    id: 'interest',
    label: 'Faiz Hesaplayıcı',
    description: 'TBK/HMK temerrüt faizi',
    href: '/tools/calculator/interest',
    icon: Calculator,
    group: 'Araçlar',
    keywords: ['faiz', 'temerrüt', 'tbk', 'hesapla'],
  },
  {
    id: 'smm',
    label: 'SMM Aracı',
    description: 'Serbest meslek makbuzu',
    href: '/tools/calculator/smm',
    icon: Calculator,
    group: 'Araçlar',
    keywords: ['smm', 'makbuz', 'vergi'],
  },
  {
    id: 'execution',
    label: 'İcra Masrafı',
    description: 'İcra ve haciz masraf hesabı',
    href: '/tools/calculator/execution',
    icon: Calculator,
    group: 'Araçlar',
    keywords: ['icra', 'haciz', 'masraf', 'harç'],
  },
];

// ── Arama filtresi ─────────────────────────────────────────────────────────
function filterItems(query: string): CommandItem[] {
  if (!query.trim()) return COMMAND_ITEMS;
  const q = query.toLowerCase().trim();
  return COMMAND_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.includes(q)),
  );
}

// ── Grup bazlı gruplama ────────────────────────────────────────────────────
function groupItems(items: CommandItem[]): Record<string, CommandItem[]> {
  return items.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});
}

// ── Ana bileşen ───────────────────────────────────────────────────────────
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K kısayolu
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Açıldığında input'a odaklan
  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href as Route);
    },
    [router],
  );

  if (!open) return null;

  const filtered = filterItems(query);
  const grouped = groupItems(filtered);

  return (
    // Backdrop — tıklanınca kapanır
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
      aria-modal="true"
      role="dialog"
      aria-label="Komut paleti"
    >
      {/* Karartma katmanı */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />

      {/* Palette kutusu */}
      <div
        className={cn(
          'relative z-10 w-full max-w-xl mx-4',
          // Araştırma raporundaki birebir spesifikasyon
          'backdrop-blur-xl bg-white/90 dark:bg-slate-900/90',
          'ring-1 ring-black/5 dark:ring-white/10',
          'rounded-2xl shadow-glass',
          'animate-fade-in-scale',
          // Sepya mod
          'sepia:bg-[#FBF0D9]/95 sepia:ring-[#E8D5B5]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Arama çubuğu */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-legal-border)]">
          <Search className="h-4 w-4 text-[var(--color-legal-text-secondary,_var(--muted-foreground))] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sayfa, araç veya özellik ara..."
            className={cn(
              'flex-1 bg-transparent text-sm text-[var(--color-legal-primary)]',
              'placeholder:text-[var(--color-legal-text-secondary,_var(--muted-foreground))]',
              'focus:outline-none',
            )}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-[var(--color-legal-text-secondary,_var(--muted-foreground))] hover:text-[var(--color-legal-primary)] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-[var(--color-legal-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-legal-text-secondary,_var(--muted-foreground))]">
            ESC
          </kbd>
        </div>

        {/* Sonuçlar */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--color-legal-text-secondary,_var(--muted-foreground))]">
              &quot;{query}&quot; için sonuç bulunamadı
            </p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-legal-text-secondary,_var(--muted-foreground))]">
                  {group}
                </p>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item.href)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5',
                        'text-sm text-[var(--color-legal-primary)]',
                        'hover:bg-[var(--color-legal-bg)] dark:hover:bg-slate-800',
                        'transition-colors duration-100',
                        'group',
                      )}
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-legal-bg)] dark:bg-slate-800 group-hover:bg-[var(--color-legal-action)]/10 transition-colors">
                        <Icon className="h-4 w-4 text-[var(--color-legal-text-secondary,_var(--muted-foreground))] group-hover:text-[var(--color-legal-action)] transition-colors" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-medium leading-tight">{item.label}</p>
                        {item.description && (
                          <p className="text-xs text-[var(--color-legal-text-secondary,_var(--muted-foreground))] mt-0.5">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--color-legal-text-secondary,_var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Alt bilgi çubuğu */}
        <div className="flex items-center gap-3 border-t border-[var(--color-legal-border)] px-4 py-2">
          <span className="text-[10px] text-[var(--color-legal-text-secondary,_var(--muted-foreground))]">
            <kbd className="font-mono">↑↓</kbd> gezin &nbsp;·&nbsp;
            <kbd className="font-mono">↵</kbd> seç &nbsp;·&nbsp;
            <kbd className="font-mono">ESC</kbd> kapat
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Trigger: Ctrl+K kısayolunu gösteren tetikleyici buton ─────────────────
export function CommandPaletteTrigger({ className }: { className?: string }) {
  return (
    <button
      onClick={() => {
        // Keydown event'i simüle ederek palette'i aç
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      }}
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2',
        'text-sm text-[var(--color-legal-text-secondary,_var(--muted-foreground))]',
        'bg-[var(--color-legal-bg)] dark:bg-slate-800',
        'border border-[var(--color-legal-border)]',
        'hover:border-[var(--color-legal-action)]/50 hover:text-[var(--color-legal-primary)]',
        'transition-colors duration-200',
        'min-h-[36px]',
        className,
      )}
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden md:inline">Ara...</span>
      <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-[var(--color-legal-border)] px-1.5 py-0.5 text-[10px] font-mono">
        ⌘K
      </kbd>
    </button>
  );
}
