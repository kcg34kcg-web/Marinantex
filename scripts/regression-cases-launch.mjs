/* eslint-disable no-console */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const STEPS = [
  {
    name: 'Cases security smoke',
    cmd: 'npm',
    args: ['run', 'smoke:security:cases'],
  },
  {
    name: 'Web typecheck',
    cmd: 'npm',
    args: ['run', 'typecheck:web'],
  },
];

function runStep(step) {
  const startedAt = Date.now();
  console.log(`[cases-launch-regression] step:start ${step.name}`);

  const result = spawnSync(step.cmd, step.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const elapsedMs = Date.now() - startedAt;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `[cases-launch-regression] step:failed ${step.name} (${elapsedMs}ms)\n${output}`,
    );
  }

  const lines = (result.stdout ?? '').split('\n').filter(Boolean);
  const tail = lines.slice(-6).join('\n');
  console.log(`[cases-launch-regression] step:ok ${step.name} (${elapsedMs}ms)`);
  if (tail) {
    console.log(tail);
  }
}

function run() {
  console.log('[cases-launch-regression] starting');
  console.log(`[cases-launch-regression] cwd=${process.cwd()}`);

  for (const step of STEPS) {
    runStep(step);
  }

  console.log('[cases-launch-regression] all checks passed');
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
