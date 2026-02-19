import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';

async function run() {
  const datasetPath = path.resolve(process.cwd(), 'evals/golden-questions.json');
  const raw = await fs.readFile(datasetPath, 'utf-8');
  const dataset = JSON.parse(raw);

  let passed = 0;

  for (const item of dataset) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 'drafting',
        outputMode: 'text',
        messages: [{ role: 'user', content: item.question }],
      }),
    });

    if (!response.ok) {
      continue;
    }

    const outputText = await response.text();
    const normalized = outputText.toLocaleLowerCase('tr-TR');

    const isHit = item.requiredKeywords.every((keyword) => normalized.includes(String(keyword).toLocaleLowerCase('tr-TR')));

    if (isHit) {
      passed += 1;
    }
  }

  const accuracy = (passed / dataset.length) * 100;
  console.log(`AI eval accuracy: ${accuracy.toFixed(2)}% (${passed}/${dataset.length})`);

  if (accuracy < 95) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
