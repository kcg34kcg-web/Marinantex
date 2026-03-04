# Master Prompt + Implementation Snippets (Glass Theme Layer)

## Scope
- Apply premium glassmorphism theming across app shell/components.
- Keep all logic/API/routing/state intact.
- Exclude direct redesign work for `/social` and `/editor` screens.

## Core Rules
- UI-only refactor with design tokens and `data-theme`.
- Accessibility: visible focus, AA contrast, reduced motion support.
- Performance: 1-2 heavy blur layers max (shell/sidebar/topbar), lighter blur for inner surfaces.
- Sidebar surface must stay darker than main content surface.

## Theme IDs (canonical)
- `ocean-cliff` (base)
- `emerald-bridge`
- `starlit-lake`
- `azure-cove`
- `alpine-reflection`
- `magenta-sunset`
- `pure-white` (no photo)

## CSS Snippet (Asset Mapping + Theme Binding)
```css
:root {
  --asset-bg-BG01: url("/assets/bg/pexels-rpnickson-2559941.jpg");
  --asset-bg-BG02: url("/assets/bg/pexels-photo-814499.jpeg");
  --asset-bg-BG03: url("/assets/bg/823e2f13b903a3790f6790ad9688d77e.jpg");
  --asset-bg-BG04: url("/assets/bg/pexels-pixabay-50594.jpg");
  --asset-bg-BG05: url("/assets/bg/i.webp");
  --asset-bg-BG06: url("/assets/bg/landscapes-nature-hdr-photography-background-pictures-wallpaper-preview.jpg");
  --asset-bg-BG07: url("/assets/bg/pexels-photo-13344137.jpeg");
  --asset-bg-BG08: url("/assets/bg/a08a9fa2af6f3bc1d5be18968fe16efb.jpg");
  --asset-bg-BG09: url("/assets/bg/71-aFCszwkL._AC_UF1000,1000_QL80_.jpg");
  --asset-bg-BG10: url("/assets/bg/landscape-mountain-backgrounds-river-wallpaper-preview.jpg");
}

[data-theme="ocean-cliff"] { --bg-image: var(--asset-bg-BG01); --bg-image-alt: var(--asset-bg-BG07); }
[data-theme="emerald-bridge"] { --bg-image: var(--asset-bg-BG02); --bg-image-alt: var(--asset-bg-BG05); }
[data-theme="starlit-lake"] { --bg-image: var(--asset-bg-BG03); --bg-image-alt: var(--asset-bg-BG10); }
[data-theme="azure-cove"] { --bg-image: var(--asset-bg-BG04); --bg-image-alt: var(--asset-bg-BG09); }
[data-theme="alpine-reflection"] { --bg-image: var(--asset-bg-BG06); --bg-image-alt: var(--asset-bg-BG10); }
[data-theme="magenta-sunset"] { --bg-image: var(--asset-bg-BG08); --bg-image-alt: var(--asset-bg-BG07); }
[data-theme="pure-white"] { --bg-image: none; --bg-image-alt: none; }
```

## TS Snippet (Theme Persistence)
```ts
const THEME_KEY = "app_theme";
const DEFAULT_THEME = "ocean-cliff";

export function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function loadTheme(): string {
  return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
}

export function saveTheme(theme: string) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function initTheme() {
  applyTheme(loadTheme());
}
```

## Implemented Files
- `app/globals.css`
- `lib/theme/theme-presets.ts`
- `lib/theme/theme-storage.ts`
- `components/theme/theme-settings-provider.tsx`
- `app/layout.tsx`
- `app/(dashboard)/layout.tsx`
- `components/layout/dashboard-sidebar.tsx`
- `components/layout/dashboard-header.tsx`
- `components/ui/button.tsx`
- `components/ui/card.tsx`
- `components/ui/input.tsx`
- `components/ui/select.tsx`
