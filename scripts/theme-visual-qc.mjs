import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const THEMES = [
  'ocean-cliff',
  'emerald-bridge',
  'starlit-lake',
  'azure-cove',
  'alpine-reflection',
  'magenta-sunset',
  'pure-white',
];

const URL = 'http://localhost:3000/login?switch=1';
const REPORT_DIR = path.resolve('artifacts/theme-qc');
const REPORT_JSON = path.join(REPORT_DIR, 'report.json');
const REPORT_MD = path.join(REPORT_DIR, 'report.md');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseColorToRgb(input) {
  const value = String(input ?? '').trim().toLowerCase();
  const rgbaMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.every((part, idx) => (idx < 3 ? Number.isFinite(part) : true))) {
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
  }

  const hexMatch = value.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hexMatch) {
    const raw = hexMatch[1];
    if (raw.length === 3) {
      return {
        r: Number.parseInt(raw[0] + raw[0], 16),
        g: Number.parseInt(raw[1] + raw[1], 16),
        b: Number.parseInt(raw[2] + raw[2], 16),
      };
    }
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }

  return null;
}

function luminance(rgb) {
  if (!rgb) return null;
  const channels = [rgb.r, rgb.g, rgb.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function urlFromCssValue(value) {
  const match = String(value ?? '').match(/url\((['"]?)(.*?)\1\)/i);
  return match ? match[2] : null;
}

async function run() {
  ensureDir(REPORT_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1720, height: 980 } });
  const page = await context.newPage();

  const report = [];

  for (const theme of THEMES) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

    await page.evaluate((nextTheme) => {
      localStorage.setItem('app_theme', nextTheme);
      const key = 'babylexit_ui_appearance_v1';
      let parsed = {};
      try {
        const raw = localStorage.getItem(key);
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      parsed.theme = nextTheme;
      localStorage.setItem(key, JSON.stringify(parsed));
    }, theme);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(600);

    const snapshotPath = path.join(REPORT_DIR, `${theme}.png`);
    await page.screenshot({ path: snapshotPath, fullPage: true });

    const data = await page.evaluate(async (expectedTheme) => {
      const root = document.documentElement;
      const shell = document.querySelector('.app-glass-shell');
      const rootStyle = getComputedStyle(root);
      const shellBefore = shell ? getComputedStyle(shell, '::before') : null;
      const shellAfter = shell ? getComputedStyle(shell, '::after') : null;

      const theme = root.getAttribute('data-theme');
      const storedTheme = localStorage.getItem('app_theme');

      const bgImage = rootStyle.getPropertyValue('--bg-image').trim();
      const bgImageSet = rootStyle.getPropertyValue('--bg-image-set').trim();
      const bgImageAlt = rootStyle.getPropertyValue('--bg-image-alt').trim();

      const sidebarSurface = rootStyle.getPropertyValue('--surface-sidebar-0').trim();
      const mainSurface = rootStyle.getPropertyValue('--surface-main-0').trim();
      const focusRing = rootStyle.getPropertyValue('--focus-ring').trim();

      const beforeBg = shellBefore?.backgroundImage ?? '';
      const afterBg = shellAfter?.backgroundImage ?? '';
      const beforeOpacity = shellBefore?.opacity ?? '';

      const resolvedImageUrl = (() => {
        const m = bgImage.match(/url\((['"]?)(.*?)\1\)/i);
        return m ? m[2] : null;
      })();

      let assetStatus = null;
      if (expectedTheme !== 'pure-white' && resolvedImageUrl) {
        try {
          const res = await fetch(resolvedImageUrl, { method: 'HEAD' });
          assetStatus = res.status;
        } catch {
          assetStatus = 0;
        }
      }

      return {
        expectedTheme,
        dataTheme: theme,
        storedTheme,
        bgImage,
        bgImageSet,
        bgImageAlt,
        sidebarSurface,
        mainSurface,
        focusRing,
        shellBeforeBackgroundImage: beforeBg,
        shellAfterBackgroundImage: afterBg,
        shellBeforeOpacity: beforeOpacity,
        assetStatus,
        hasShell: Boolean(shell),
      };
    }, theme);

    const sidebarLum = luminance(parseColorToRgb(data.sidebarSurface));
    const mainLum = luminance(parseColorToRgb(data.mainSurface));
    const sidebarDarkerThanMain =
      typeof sidebarLum === 'number' && typeof mainLum === 'number' ? sidebarLum < mainLum : null;

    const passTheme = data.dataTheme === theme && data.storedTheme === theme;
    const passPhoto =
      theme === 'pure-white' ? data.bgImage === 'none' || data.bgImageSet === 'none' : data.assetStatus === 200;
    const passShell =
      data.hasShell &&
      data.shellAfterBackgroundImage !== 'none' &&
      (theme === 'pure-white' ? true : data.shellBeforeBackgroundImage !== 'none');
    const passHierarchy = sidebarDarkerThanMain === true;

    report.push({
      ...data,
      snapshot: snapshotPath,
      sidebarLuminance: sidebarLum,
      mainLuminance: mainLum,
      sidebarDarkerThanMain,
      checks: {
        themeApplied: passTheme,
        backgroundReady: passPhoto,
        shellLayersPresent: passShell,
        sidebarHierarchy: passHierarchy,
      },
      overallPass: passTheme && passPhoto && passShell && passHierarchy,
    });
  }

  await browser.close();

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const lines = [];
  lines.push('# Theme Visual QC Report');
  lines.push('');
  lines.push(`URL: \`${URL}\``);
  lines.push('');
  lines.push('| Theme | Theme Applied | Background | Shell Layers | Sidebar<Main | Overall |');
  lines.push('|---|---|---|---|---|---|');
  for (const row of report) {
    lines.push(
      `| ${row.expectedTheme} | ${row.checks.themeApplied ? 'PASS' : 'FAIL'} | ${row.checks.backgroundReady ? 'PASS' : 'FAIL'} | ${row.checks.shellLayersPresent ? 'PASS' : 'FAIL'} | ${row.checks.sidebarHierarchy ? 'PASS' : 'FAIL'} | ${row.overallPass ? 'PASS' : 'FAIL'} |`,
    );
  }
  lines.push('');
  lines.push('## Screenshots');
  for (const row of report) {
    lines.push(`- ${row.expectedTheme}: \`${path.relative(process.cwd(), row.snapshot)}\``);
  }
  lines.push('');

  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');

  const failed = report.filter((row) => !row.overallPass);
  console.log(`Theme QC done. Total: ${report.length}, Passed: ${report.length - failed.length}, Failed: ${failed.length}`);
  if (failed.length > 0) {
    console.log('Failed themes:', failed.map((f) => f.expectedTheme).join(', '));
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
