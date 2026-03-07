# Editor UDF Integration

## What this feature does

This integration adds three new actions to the existing `editor` page:

- `UDF indir`
- `UDF iç kopyala`
- `UYAP uyumlu kopyala`

The editor core model is unchanged. UDF support is implemented as a separate adapter layer.

## Integration point in editor page

Main UI integration is done in:

- `apps/web/components/editor/editor-unified.tsx`

The existing toolbar and export/menu behavior remain in place. New actions are attached to current toolbar menus without removing any existing buttons.

## Architecture

### Core rule

- Editor keeps its own Tiptap JSON model.
- UDF export and clipboard compatibility work through adapter modules.
- UDF generation does not use raw DOM scraping or direct HTML serialization.

### Adapter modules

- `apps/web/lib/editor/udf/types.ts`
- `apps/web/lib/editor/udf/font-normalization.ts`
- `apps/web/lib/editor/udf/mapEditorToDocModel.ts`
- `apps/web/lib/editor/udf/importUdf.ts`
- `apps/web/lib/editor/udf/xmlBuilder.ts`
- `apps/web/lib/editor/udf/zip.ts`
- `apps/web/lib/editor/udf/exportUdf.ts`
- `apps/web/lib/editor/udf/downloadUdf.ts`

### Clipboard modules

- `apps/web/lib/editor/clipboard/types.ts`
- `apps/web/lib/editor/clipboard/selection.ts`
- `apps/web/lib/editor/clipboard/renderUyapCompatibleHtml.ts`
- `apps/web/lib/editor/clipboard/copyInternalUdfFragment.ts`
- `apps/web/lib/editor/clipboard/copyUyapCompatible.ts`
- `apps/web/lib/editor/clipboard/pasteInternalUdfFragment.ts`

## How `UDF indir` works

1. Read editor internal JSON (`editor.getJSON()`).
2. Convert JSON to `DocModel`.
3. Normalize fonts and collect compatibility warnings.
4. Build `content.xml` with a global content buffer and offset references.
5. Run structural validation on generated XML/ZIP (`validateUdfContentXml`, `validateUdfArchive`).
6. Package files as ZIP (`content.xml`, `document.xml`, `META-INF/manifest.xml`, `manifest.json`, `warnings.txt`).
7. Download with `.udf` extension.

## How `UDF iç kopyala` works

1. Capture selected fragment (or full content if selection is empty).
2. Build a high-fidelity custom clipboard payload:
   - `application/x-marinantex-udf-fragment+json` (primary source)
   - `text/html`
   - `text/plain`
3. Paste flow on this editor checks in order:
   - custom mime payload
   - internal marked HTML
   - plain text paragraph fallback
4. If modern Clipboard API is unavailable, copy falls back to legacy `execCommand("copy")` path.

## How `UYAP uyumlu kopyala` works

1. Capture selected fragment from internal model.
2. Convert to `DocModel`.
3. Render simplified inline-style HTML (no class-based styles).
4. Prefer safe font fallback (`Times New Roman`) for compatibility.
5. Write both `text/html` + `text/plain` to clipboard.
6. If modern Clipboard API is unavailable, copy falls back to legacy `execCommand("copy")` path.

This mode is intentionally best-effort, not strict round-trip fidelity.

## Keyboard shortcuts

- `Ctrl/Cmd + Alt + C`: `UDF iç kopyala`
- `Ctrl/Cmd + Alt + U`: `UYAP uyumlu kopyala`

## Why two copy modes exist

- `UDF iç kopyala`: optimized for same-app high-fidelity round-trip.
- `UYAP uyumlu kopyala`: optimized for external closed editors with simplified output.

## Supported formatting

- Paragraphs
- Inline text
- Tab character
- Basic alignment
- Basic font family + size
- Bold / Italic / Underline
- Tables / rows / cells
- Basic table borders
- Empty paragraph protection

## Degraded/unsupported behaviors

- Nested tables are flattened to text fallback with warning.
- Complex row/col spans are exported with degradation warnings.
- Unknown fonts are normalized to safe fallback.
- Complex advanced border combinations are simplified.

## Known limitations

- Closed UDF format compatibility cannot be guaranteed 100%.
- Export is best-effort and model-driven.
- Some external editors may ignore inline CSS or collapse complex structures.

## CI compatibility gate

- Command: `npm run test:udf:compat`
- Script: `scripts/run-udf-compat-check.mjs`
- Workflow: `.github/workflows/ci.yml` -> `Web UDF Compatibility Harness`
- Manual external gate: `docs/editor/udf-external-validation-checklist.md`
