'use client';

import { useCallback, useEffect, useRef, useState, type ElementType } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  ArrowRight,
  BrainCircuit,
  Briefcase,
  Building2,
  Calculator,
  FileSignature,
  Library,
  LayoutDashboard,
  Search,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  href: string;
  icon: ElementType;
  group: string;
  keywords: string[];
}

const COMMAND_ITEMS: CommandItem[] = [
  {
    id: 'dashboard',
    label: 'Panel',
    description: 'Genel ozet',
    href: '/dashboard',
    icon: LayoutDashboard,
    group: 'Calisma Alani',
    keywords: ['panel', 'ozet', 'dashboard'],
  },
  {
    id: 'cases',
    label: 'Dosyalar',
    description: 'Dosyalar ve durumlar',
    href: '/dashboard/cases',
    icon: Briefcase,
    group: 'Calisma Alani',
    keywords: ['dava', 'dosya', 'case'],
  },
  {
    id: 'clients',
    label: 'Muvekkiller',
    description: 'Muvekkil kayitlari',
    href: '/dashboard/clients',
    icon: Users,
    group: 'Calisma Alani',
    keywords: ['muvekkil', 'client'],
  },
  {
    id: 'time-billing',
    label: 'Zaman ve Tahsilat',
    description: 'Sure, masraf, fatura ve cari paneli',
    href: '/dashboard/time-billing',
    icon: Wallet,
    group: 'Calisma Alani',
    keywords: ['zaman', 'ucret', 'fatura', 'tahsilat', 'cari', 'masraf'],
  },
  {
    id: 'office',
    label: 'Ofisim',
    description: 'Ekip ve ofis akis',
    href: '/office',
    icon: Building2,
    group: 'Calisma Alani',
    keywords: ['ofis', 'ekip'],
  },
  {
    id: 'settings',
    label: 'Ayarlar',
    description: 'Tema ve gorunum tercihleri',
    href: '/dashboard/settings',
    icon: Settings,
    group: 'Calisma Alani',
    keywords: ['ayar', 'tema', 'gorunum'],
  },
  {
    id: 'corpus',
    label: 'Corpus',
    description: 'Corpus yonetimi',
    href: '/dashboard/corpus',
    icon: Library,
    group: 'Yapay Zeka',
    keywords: ['corpus', 'ingest'],
  },
  {
    id: 'hukuk-ai',
    label: 'Hukuk AI',
    description: 'RAG arastirmasi',
    href: '/tools/hukuk-ai',
    icon: BrainCircuit,
    group: 'Yapay Zeka',
    keywords: ['ai', 'rag', 'arastirma'],
  },
  {
    id: 'dilekce-sihirbazi',
    label: 'Dilekce Sihirbazi',
    description: 'Adimli dilekce taslagi uretimi',
    href: '/tools/dilekce-sihirbazi',
    icon: FileSignature,
    group: 'Yapay Zeka',
    keywords: ['dilekce', 'sihirbaz', 'taslak', 'petition'],
  },
  {
    id: 'kaynak-ictihat-arama',
    label: 'Kaynak / Ictihat Arama',
    description: 'Ictihat, mevzuat, akademik ve web aramasi',
    href: '/tools/kaynak-ictihat-arama',
    icon: Search,
    group: 'Yapay Zeka',
    keywords: ['kaynak', 'ictihat', 'mevzuat', 'akademik', 'web', 'arama'],
  },
  {
    id: 'interest',
    label: 'Faiz Hesaplayici',
    description: 'TBK/HMK faiz',
    href: '/tools/calculator/interest',
    icon: Calculator,
    group: 'Araclar',
    keywords: ['faiz', 'hesapla'],
  },
  {
    id: 'smm',
    label: 'SMM Araci',
    description: 'Serbest meslek',
    href: '/tools/calculator/smm',
    icon: Calculator,
    group: 'Araclar',
    keywords: ['smm'],
  },
  {
    id: 'execution',
    label: 'Icra Masrafi',
    description: 'Icra giderleri',
    href: '/tools/calculator/execution',
    icon: Calculator,
    group: 'Araclar',
    keywords: ['icra', 'masraf'],
  },
];

function filterItems(query: string): CommandItem[] {
  if (!query.trim()) {
    return COMMAND_ITEMS;
  }

  const normalized = query.toLowerCase().trim();
  return COMMAND_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(normalized) ||
      item.description?.toLowerCase().includes(normalized) ||
      item.keywords.some((keyword) => keyword.includes(normalized)),
  );
}

function groupItems(items: CommandItem[]): Record<string, CommandItem[]> {
  return items.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.group]) {
      acc[item.group] = [];
    }
    acc[item.group].push(item);
    return acc;
  }, {});
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href as Route);
    },
    [router],
  );

  if (!open) {
    return null;
  }

  const filtered = filterItems(query);
  const grouped = groupItems(filtered);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Komut paleti"
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />

      <div
        className={cn(
          'relative z-10 mx-4 w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)]',
          'bg-[color-mix(in_srgb,var(--surface),transparent_6%)] shadow-2xl backdrop-blur-xl',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search className="h-4 w-4 flex-shrink-0 text-[var(--secondary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sayfa veya ozellik ara..."
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--secondary)] focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[var(--secondary)] transition-colors hover:text-[var(--text)]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--secondary)] sm:inline-flex">
            ESC
          </kbd>
        </div>

        <div className="max-h-[62vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-7 text-center text-sm text-[var(--secondary)]">Sonuc bulunamadi.</p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  {group}
                </p>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelect(item.href)}
                      className={cn(
                        'group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        'hover:bg-[color-mix(in_srgb,var(--surface),var(--primary)_8%)]',
                      )}
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                        <Icon className="h-4 w-4 text-[var(--secondary)] group-hover:text-[var(--primary)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text)]">{item.label}</p>
                        {item.description ? (
                          <p className="truncate text-xs text-[var(--secondary)]">{item.description}</p>
                        ) : null}
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--secondary)] opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--secondary)]">
          Ctrl/Cmd + K: ac - ESC: kapat
        </div>
      </div>
    </div>
  );
}

export function CommandPaletteTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: true,
            bubbles: true,
          }),
        );
      }}
      className={cn(
        'inline-flex min-h-[36px] items-center gap-2 rounded-xl border border-[var(--border)]',
        'bg-[var(--surface)] px-3 py-2 text-sm text-[var(--secondary)] transition-colors',
        'hover:text-[var(--text)]',
        className,
      )}
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden md:inline">Ara...</span>
      <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] md:inline-flex">
        Ctrl+K
      </kbd>
    </button>
  );
}
