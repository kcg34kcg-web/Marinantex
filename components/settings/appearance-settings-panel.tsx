'use client';

import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useThemeSettings } from '@/components/theme/theme-settings-provider';
import {
  CONTRAST_LEVEL_OPTIONS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  SIDEBAR_DENSITY_OPTIONS,
  THEME_OPTIONS,
} from '@/lib/theme/theme-presets';

export function AppearanceSettingsPanel() {
  const {
    settings,
    setTheme,
    setFontFamily,
    setFontSize,
    setLineHeight,
    setSidebarDensity,
    setContrastLevel,
    setReduceMotion,
    resetSettings,
  } = useThemeSettings();

  return (
    <Card className="border-[var(--border)]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Gorunum ve Tema Ayarlari</CardTitle>
            <p className="mt-1 text-sm text-[var(--secondary)]">
              Tema, tipografi ve erisilebilirlik tercihleri tum uygulamaya aninda uygulanir.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={resetSettings}>
            <RotateCcw className="h-4 w-4" />
            Sifirla
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">Tema</label>
            <Select
              value={settings.theme}
              onChange={(event) => setTheme(event.target.value as (typeof THEME_OPTIONS)[number]['value'])}
            >
              {THEME_OPTIONS.map((theme) => (
                <option key={theme.value} value={theme.value}>
                  {theme.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">
              Yazi Font Ailesi
            </label>
            <Select
              value={settings.fontFamily}
              onChange={(event) =>
                setFontFamily(event.target.value as (typeof FONT_FAMILY_OPTIONS)[number]['value'])
              }
            >
              {FONT_FAMILY_OPTIONS.map((fontFamily) => (
                <option key={fontFamily.value} value={fontFamily.value}>
                  {fontFamily.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">Font Boyutu</label>
            <Select
              value={settings.fontSize}
              onChange={(event) => setFontSize(event.target.value as (typeof FONT_SIZE_OPTIONS)[number]['value'])}
            >
              {FONT_SIZE_OPTIONS.map((fontSize) => (
                <option key={fontSize.value} value={fontSize.value}>
                  {fontSize.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">Satir Yuksekligi</label>
            <Select
              value={settings.lineHeight}
              onChange={(event) =>
                setLineHeight(event.target.value as (typeof LINE_HEIGHT_OPTIONS)[number]['value'])
              }
            >
              {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                <option key={lineHeight.value} value={lineHeight.value}>
                  {lineHeight.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">Sidebar Yogunlugu</label>
            <Select
              value={settings.sidebarDensity}
              onChange={(event) =>
                setSidebarDensity(event.target.value as (typeof SIDEBAR_DENSITY_OPTIONS)[number]['value'])
              }
            >
              {SIDEBAR_DENSITY_OPTIONS.map((sidebarDensity) => (
                <option key={sidebarDensity.value} value={sidebarDensity.value}>
                  {sidebarDensity.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">
              Kontrast Seviyesi
            </label>
            <Select
              value={settings.contrastLevel}
              onChange={(event) =>
                setContrastLevel(event.target.value as (typeof CONTRAST_LEVEL_OPTIONS)[number]['value'])
              }
            >
              {CONTRAST_LEVEL_OPTIONS.map((contrastLevel) => (
                <option key={contrastLevel.value} value={contrastLevel.value}>
                  {contrastLevel.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-1">
          <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">Animasyonlari azalt</p>
              <p className="text-xs text-[var(--secondary)]">Hareketli gecisleri minimuma indirir.</p>
            </div>
            <Toggle checked={settings.reduceMotion} onCheckedChange={setReduceMotion} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
