import type { AssistantTool, ToolExecutionInput } from '@/lib/tools/types';

const indexedDocs = [
  {
    id: 'doc-1',
    title: 'Kira Sözleşmesi Örneği',
    excerpt: 'Kiraya veren ve kiracı yükümlülükleri, fesih şartları.',
    tags: ['kira', 'sözleşme'],
  },
  {
    id: 'doc-2',
    title: 'İcra Takip Süreci Notları',
    excerpt: 'Ödeme emri, itiraz süresi ve haciz adımları.',
    tags: ['icra', 'takip', 'haciz'],
  },
  {
    id: 'doc-3',
    title: 'İş Sözleşmesi Fesih Kontrol Listesi',
    excerpt: 'Haklı nedenler, ihbar süreleri, kıdem tazminatı koşulları.',
    tags: ['iş', 'fesih'],
  },
];

function scoreDocument(doc: { title: string; excerpt: string; tags: string[] }, query: string) {
  const q = query.toLocaleLowerCase('tr-TR');
  let score = 0;
  if (doc.title.toLocaleLowerCase('tr-TR').includes(q)) score += 5;
  if (doc.excerpt.toLocaleLowerCase('tr-TR').includes(q)) score += 3;
  for (const tag of doc.tags) {
    if (q.includes(tag) || tag.includes(q)) score += 2;
  }
  return score;
}

export const fileSearchTool: AssistantTool = {
  name: 'files.search',
  label: 'Dosya bul',
  description: 'Yerel indeks içinde dosya/metin araması yapar.',
  requiresConfirmation: false,
  async preview(input: ToolExecutionInput) {
    const query = String(input.params.query ?? '').trim();
    const results =
      query.length === 0
        ? []
        : indexedDocs
            .map((doc) => ({ doc, score: scoreDocument(doc, query) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .map((item) => item.doc);

    return {
      summary: query.length === 0 ? 'Arama sorgusu gerekli.' : `${results.length} sonuç bulundu.`,
      preview: {
        query,
        results,
      },
      requiresConfirmation: false,
    };
  },
  async run(input: ToolExecutionInput) {
    const preview = await this.preview(input);
    return {
      summary: preview.summary,
      output: preview.preview,
    };
  },
};
