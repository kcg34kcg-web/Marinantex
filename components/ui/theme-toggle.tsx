'use client';

import { useTheme } from 'next-themes';
import { Sun, Moon, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Üç Yönlü Tema Toggle ─────────────────────────────────────────────────────
// Harvey AI, CoCounsel, Lexis+'da bulunmayan eşsiz özellik: Sepya/E-Ink modu
// OS tercihini (prefers-color-scheme) önce ThemeProvider otomatik alır;
// kullanıcı manuel geçiş yapabilir.
const THEMES = [
  {
    value: 'light',
    label: 'Aydınlık',
    icon: Sun,
    title: 'Klasik Aydınlık Mod',
  },
  {
    value: 'dark',
    label: 'Karanlık',
    icon: Moon,
    title: 'Gelişmiş Karanlık Mod (halasyon koruması)',
  },
  {
    value: 'sepia',
    label: 'Sepya',
    icon: BookOpen,
    title: 'E-Ink Okuma Modu — uzun hukuki metin incelemesi için',
  },
] as const;

interface ThemeToggleProps {
  /** Kompakt: sadece ikonlar (sidebar collapsed modu için) */
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    // Sidebar daraltılmış: tek ikon — mevcut temayı döngüsel değiştirir
    const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];
    const next = THEMES[(THEMES.findIndex((t) => t.value === theme) + 1) % THEMES.length];
    const Icon = current.icon;

    return (
      <button
        onClick={() => setTheme(next.value)}
        title={`Şu an: ${current.label} → ${next.label}'a geç`}
        className={cn(
          'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl',
          'text-[var(--color-legal-text-secondary,_var(--muted-foreground))]',
          'hover:bg-[var(--color-legal-bg)] dark:hover:bg-slate-800',
          'transition-colors duration-200',
          className,
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  // Tam görünüm: üç buton, aktif sliding pill ile
  return (
    <div
      role="group"
      aria-label="Tema seçimi"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl p-1',
        'bg-[var(--color-legal-bg)] dark:bg-slate-800 border border-[var(--color-legal-border)]',
        className,
      )}
    >
      {THEMES.map(({ value, label, icon: Icon, title }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={title}
            aria-pressed={isActive}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
              'transition-all duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-legal-action)]',
              isActive
                ? 'bg-[var(--color-legal-surface)] text-[var(--color-legal-primary)] shadow-legal-sm dark:bg-slate-700 dark:text-white'
                : 'text-[var(--color-legal-text-secondary,_var(--muted-foreground))] hover:text-[var(--color-legal-primary)] dark:hover:text-white',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
