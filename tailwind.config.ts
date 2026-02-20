import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', './store/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Mevcut HSL tokenlar (geriye dönük uyumluluk) ──────────────────────
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        // ── Yeni OKLCH tabanlı semantik design tokenlar ───────────────────────
        // 60/30/10 kuralı: legal-primary (%60), legal-action (%30), legal-accent (%10)
        legal: {
          bg: 'var(--color-legal-bg)', // oklch(98% 0.01 250) → #F8FAFC
          surface: 'var(--color-legal-surface)', // oklch(100% 0 0)     → #FFFFFF
          primary: 'var(--color-legal-primary)', // oklch(25% 0.04 250) → #0F172A Deep Navy
          action: 'var(--color-legal-action)', // oklch(60% 0.16 250) → #3B82F6 Royal Blue
          accent: 'var(--color-legal-accent)', // oklch(75% 0.12 70)  → #D4A574 Soft Gold
          success: 'var(--color-legal-success)', // oklch(60% 0.12 160) → #009B77 Emerald Ice
          border: 'var(--color-legal-border)',
          muted: 'var(--color-legal-text-secondary)',
        },
        sepia: {
          bg: 'var(--color-sepia-bg)',
          surface: 'var(--color-sepia-surface)',
          text: 'var(--color-sepia-text)',
          muted: 'var(--color-sepia-text-muted)',
          accent: 'var(--color-sepia-accent)',
          border: 'var(--color-sepia-border)',
        },
      },
      // ── Tipografi: Playfair Display (hukuki otorite) + Inter (UI netliği) ──
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Playfair Display', 'Georgia', 'serif'],
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: '0.875rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      // ── Animasyon keyframe'leri ───────────────────────────────────────────
      keyframes: {
        // Skeleton shimmer — gerçek bekleme hissini kalıpla geçirir (vs spinner)
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // AI mesaj belirmesi — Framer Motion eşdeğeri CSS ile
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-scale': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s linear infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'fade-in-scale': 'fade-in-scale 0.2s ease-out',
      },
      backgroundSize: {
        '200': '200%',
      },
      // ── Premium gölge skalası — Glassmorphism & CTA desteği ──────────────
      boxShadow: {
        'legal-sm': '0 1px 3px 0 rgba(15,23,42,0.08), 0 1px 2px -1px rgba(15,23,42,0.06)',
        'legal-md': '0 4px 6px -1px rgba(15,23,42,0.08), 0 2px 4px -2px rgba(15,23,42,0.06)',
        'legal-lg': '0 10px 15px -3px rgba(15,23,42,0.08), 0 4px 6px -4px rgba(15,23,42,0.05)',
        'legal-cta': '0 8px 30px rgba(59,130,246,0.22)',
        glass: '0 8px 32px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.15)',
      },
    },
  },
  plugins: [],
};

export default config;
