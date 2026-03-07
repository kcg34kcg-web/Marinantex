import type { Metadata } from 'next';
import Script from 'next/script';
import { Manrope, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { FloatingGavelButton } from '@/components/layout/floating-gavel-button';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Babylexit',
  description: 'Yapay zekâ destekli hukuk işletim sistemi',
};

const APPEARANCE_STORAGE_KEY = 'babylexit_ui_appearance_v1';
const THEME_STORAGE_KEY = 'app_theme';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="tr"
      suppressHydrationWarning
      className={`${manrope.variable} ${sourceSerif.variable}`}
      // fallback (JS çalışmazsa)
      data-theme="light-mode"
      data-font-family="system"
      data-font-size="medium"
      data-line-height="normal"
      data-sidebar-density="normal"
      data-contrast-level="normal"
      data-reduce-motion="false"
      data-high-contrast="false"
    >
      <body className="antialiased" suppressHydrationWarning>
        <Script id="ui-appearance-boot" strategy="beforeInteractive">
          {`
            (function () {
              try {
                var raw = localStorage.getItem('${APPEARANCE_STORAGE_KEY}');
                var parsed = {};
                if (raw) {
                  var candidate = JSON.parse(raw);
                  if (candidate && typeof candidate === 'object') parsed = candidate;
                }

                var root = document.documentElement;
                var themeRaw = localStorage.getItem('${THEME_STORAGE_KEY}') || parsed.theme;
                var themeMap = {
                  dark: 'dark-mode',
                  light: 'light-mode',
                  young: 'young-mode',
                  reading: 'reading-mode',
                  natureCalm: 'light-mode',
                  modernCitrus: 'young-mode',
                  warmPro: 'reading-mode',
                  youthPop: 'young-mode',
                  luxAggressive: 'dark-mode',
                  aquaWave: 'light-mode',
                  roseDream: 'young-mode',
                  graphiteDark: 'dark-mode',
                  neoContrast: 'young-mode',
                  pureWhite: 'light-mode',
                  'nature-calm': 'light-mode',
                  'modern-citrus': 'young-mode',
                  'warm-pro': 'reading-mode',
                  'youth-pop': 'young-mode',
                  'lux-aggressive': 'dark-mode',
                  'aqua-wave': 'light-mode',
                  'rose-dream': 'young-mode',
                  'graphite-dark': 'dark-mode',
                  'neo-contrast': 'young-mode',
                  'ocean-cliff': 'dark-mode',
                  'emerald-bridge': 'light-mode',
                  'starlit-lake': 'dark-mode',
                  'azure-cove': 'young-mode',
                  'alpine-reflection': 'light-mode',
                  'magenta-sunset': 'young-mode',
                  'pure-white': 'reading-mode'
                };
                var allowedThemes = {
                  'dark-mode': true,
                  'light-mode': true,
                  'young-mode': true,
                  'reading-mode': true
                };
                var normalizedTheme = themeMap[themeRaw] || themeRaw || 'light-mode';
                if (!allowedThemes[normalizedTheme]) normalizedTheme = 'light-mode';
                var pathname = window.location.pathname || '';
                var isThemeLockedRoute =
                  pathname === '/editor' ||
                  pathname.indexOf('/editor/') === 0 ||
                  pathname === '/social' ||
                  pathname.indexOf('/social/') === 0;
                var effectiveTheme = isThemeLockedRoute ? 'reading-mode' : normalizedTheme;

                root.setAttribute('data-theme', effectiveTheme);
                localStorage.setItem('${THEME_STORAGE_KEY}', normalizedTheme);
                if (parsed.fontFamily) root.setAttribute('data-font-family', parsed.fontFamily);
                if (parsed.fontSize) root.setAttribute('data-font-size', parsed.fontSize);
                if (parsed.lineHeight) root.setAttribute('data-line-height', parsed.lineHeight);
                if (parsed.sidebarDensity) root.setAttribute('data-sidebar-density', parsed.sidebarDensity);
                var contrastLevel = parsed.contrastLevel === 'high' ? 'high' : 'normal';
                if (typeof parsed.highContrast === 'boolean' && parsed.highContrast) contrastLevel = 'high';
                root.setAttribute('data-contrast-level', contrastLevel);
                if (typeof parsed.reduceMotion === 'boolean') root.setAttribute('data-reduce-motion', String(parsed.reduceMotion));
                root.setAttribute('data-high-contrast', String(contrastLevel === 'high'));

                // ✅ FONT SIZE: ilk paint’te anında uygula
                var fs = parsed.fontSize;
                var fontSizeMap = { small: '14px', medium: '16px', large: '18px', xl: '20px' };
                if (fs && fontSizeMap[fs]) root.style.fontSize = fontSizeMap[fs];

                // dark class (provider ile tutarlı)
                var darkThemes = { 'dark-mode': true };
                if (darkThemes[effectiveTheme]) root.classList.add('dark');
                else root.classList.remove('dark');
              } catch (e) {}
            })();
          `}
        </Script>

        <Providers>
          {children}
          <FloatingGavelButton />
        </Providers>
      </body>
    </html>
  );
}
