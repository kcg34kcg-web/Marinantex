# UDF and Clipboard Test Plan

## Test matrix

| # | Scenario | UDF Export | Internal Copy/Paste | UYAP Copy |
|---|---|---|---|---|
| 1 | Plain text only | Should pass with zero warning | Exact text round-trip | Plain html/text pass |
| 2 | Bold/italic/underline | Marks preserved as inline attributes | Exact style if custom mime available | Inline style best-effort |
| 3 | Mixed fonts + font size | Known fonts preserved, unknown fallback warned | Exact if custom mime, fallback otherwise | Unknown fonts normalized to Times |
| 4 | Left/center/right/justify | Paragraph alignment serialized | Preserved via custom payload | Preserved with inline `text-align` |
| 5 | Empty-line document | Placeholder keeps empty paragraphs | Preserved | Usually preserved via `&nbsp;` |
| 6 | Tab characters | Serialized as tab nodes + offsets | Preserved | Rendered as spacing span |
| 7 | Simple table | Row/cell structure serialized | Preserved | Inline bordered table |
| 8 | Multi-line cell text | LineBreak nodes serialized | Preserved | `<br />` in cell content |
| 9 | Large document | Archive generated with stable offsets | Depends on clipboard limit | Best-effort, may be heavy |
| 10 | Mixed formatting + table | Structure + warnings for degraded parts | Preserved in app | Simplified external-safe output |

## Unit tests included

- `tests/udf-doc-model.test.ts`
  - model mapping, alignment, tabs, warning behavior
- `tests/udf-xml-builder.test.ts`
  - content buffer offset generation, empty paragraph placeholder, zip header
- `tests/udf-validation.test.ts`
  - `content.xml`/ZIP structural validation and out-of-range guard
- `tests/udf-import.test.ts`
  - `.udf` archive -> `DocModel` -> editor JSON import round-trip
  - `document.xml` fallback path
  - malformed offset parser warning behavior
- `tests/uyap-html-renderer.test.ts`
  - inline style HTML, table rendering

## Integration-style tests included

- `tests/editor-clipboard.test.ts`
  - custom mime paste priority
  - internal HTML fallback
  - plain text fallback
  - file-item guard for image clipboard cases
- `tests/editor-clipboard-copy.test.ts`
  - Clipboard API yokken legacy `execCommand("copy")` fallback
  - internal/UYAP copy modlarinda payload dogrulama

## Golden compatibility harness

- Fixture source: `tests/fixtures/udf-golden/documents.json`
- Harness test: `tests/udf-compat-harness.test.ts`
- Snapshot baseline: `tests/__snapshots__/udf-compat-harness.test.ts.snap`
- CI command: `npm run test:udf:compat`
- CI workflow job: `Web UDF Compatibility Harness` in `.github/workflows/ci.yml`
- Fixture seti 10 senaryonun tamamini 1:1 kapsar.
- Harness fixture dongusu ek olarak her senaryo icin:
  - internal custom MIME paste yolunu
  - UYAP uyumlu HTML render yolunu da dogrular.

## Fallback mapping

| Source feature | Preferred path | Fallback path |
|---|---|---|
| Internal copy data | custom mime json | internal html -> plain text |
| Font family | known family pass-through | `Times New Roman` |
| Empty paragraph | zero-width placeholder in UDF | `&nbsp;` in HTML |
| Table spans | keep numeric span and warn | simplify behavior in UYAP HTML |
| Nested tables | flatten text + warn | paragraph fallback |

## Logging and warning policy

- Warnings are stored in `DocModel.warnings`.
- Export writes warnings to `warnings.txt` inside `.udf` archive.
- UI message shows operation mode and first warning for quick feedback.
