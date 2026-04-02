#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const command = "npx";
const args = [
  "--yes",
  "vitest@3.2.4",
  "run",
  "--config",
  "vitest.udf.config.mjs",
  "tests/udf-compat-harness.test.ts",
  "tests/udf-doc-model.test.ts",
  "tests/udf-validation.test.ts",
  "tests/udf-import.test.ts",
  "tests/udf-xml-builder.test.ts",
  "tests/editor-clipboard.test.ts",
  "tests/editor-clipboard-copy.test.ts",
  "tests/uyap-html-renderer.test.ts",
];

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("UDF compatibility check failed to start:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
