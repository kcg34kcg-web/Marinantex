# Third-Party and License Notes (UDF Integration)

## Scope

This note covers only the new UDF export and clipboard compatibility integration.

## New runtime dependencies

- None added.

## New dev dependencies

- None added to `package.json`.
- CI/test harness invokes `vitest@3.2.4` via `npx` in `scripts/run-udf-compat-check.mjs`.

## License detail for tools used by this feature

| Package | Version | License | Usage scope |
|---|---|---|---|
| `vitest` | `3.2.4` | `MIT` | Test harness only (`npm run test:udf:compat`) |

## License posture

- Implementation is clean-room and original.
- No code copied from `saidsurucu/UDF-Toolkit` or similar unclear-license repositories.
- Design is behavior-informed only, code is newly written.

## Existing project dependencies touched

- No existing dependency license was changed by this feature.

## Commercial usage risk

- No additional third-party runtime package risk introduced by this feature.
- Compatibility with closed formats remains best-effort and should be validated in target environments.
