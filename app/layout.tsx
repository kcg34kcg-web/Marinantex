import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const playfair = Playfair_Display({
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
      className={`${inter.variable} ${playfair.variable}`}
      // fallback (JS çalışmazsa)
      data-theme="ocean-cliff"
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
                  natureCalm: 'ocean-cliff',
                  modernCitrus: 'azure-cove',
                  warmPro: 'emerald-bridge',
                  youthPop: 'azure-cove',
                  luxAggressive: 'starlit-lake',
                  aquaWave: 'alpine-reflection',
                  roseDream: 'magenta-sunset',
                  graphiteDark: 'starlit-lake',
                  neoContrast: 'azure-cove',
                  pureWhite: 'pure-white',
                  'nature-calm': 'ocean-cliff',
                  'modern-citrus': 'azure-cove',
                  'warm-pro': 'emerald-bridge',
                  'youth-pop': 'azure-cove',
                  'lux-aggressive': 'starlit-lake',
                  'aqua-wave': 'alpine-reflection',
                  'rose-dream': 'magenta-sunset',
                  'graphite-dark': 'starlit-lake',
                  'neo-contrast': 'azure-cove'
                };
                var allowedThemes = {
                  'ocean-cliff': true,
                  'emerald-bridge': true,
                  'starlit-lake': true,
                  'azure-cove': true,
                  'alpine-reflection': true,
                  'magenta-sunset': true,
                  'pure-white': true
                };
                var normalizedTheme = themeMap[themeRaw] || themeRaw || 'ocean-cliff';
                if (!allowedThemes[normalizedTheme]) normalizedTheme = 'ocean-cliff';
                var pathname = window.location.pathname || '';
                var isThemeLockedRoute =
                  pathname === '/editor' ||
                  pathname.indexOf('/editor/') === 0 ||
                  pathname === '/social' ||
                  pathname.indexOf('/social/') === 0;
                var effectiveTheme = isThemeLockedRoute ? 'pure-white' : normalizedTheme;

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
                var darkThemes = { 'starlit-lake': true, 'magenta-sunset': true };
                if (darkThemes[effectiveTheme]) root.classList.add('dark');
                else root.classList.remove('dark');
              } catch (e) {}
            })();
          `}
        </Script>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
