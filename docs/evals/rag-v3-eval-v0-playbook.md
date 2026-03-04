# RAG v3 Eval Set v0 Playbook (200-300)

## 1) Hedef
- Ayrim: `retrieval bozuk mu` yoksa `model bozuk mu`.
- Ilk asamada teknik KPI:
  - `citation_coverage > 0.80`
  - `no_answer_accuracy > 0.90` (unanswerable satirlari icin)
  - `p95 latency` olculuyor (optimizasyon sonraki asama)
  - `fingerprint_coverage = 1.00` (her cevapta fingerprint var)

## 2) Her cevapta zorunlu fingerprint
API cevabinda `fingerprint` altinda su alanlar zorunlu:
- `model_name`
- `model_version`
- `index_version` (embedding modeli + retrieval paramlari dahil)
- `prompt_version`
- `doc_hashes` / `chunk_hashes`

Not: Bir soruda birden fazla kanit gelebilecegi icin hash alanlari liste olarak tutulur.

## 3) Veri boyutu ve kategori dagilimi
V0 icin pratik hedef: `240` satir (200-300 araliginda).

Onerilen dagilim:
- `answerable`: 100
- `unanswerable`: 60
- `celiskili`: 35
- `zaman_hassas`: 35
- `adversarial`: 10

Minimum kural:
- Her kategoride en az `20` satir olsun.
- Tek bir kanun/kurum tum setin `%35`inden fazla olmasin.

## 4) JSONL satir semasi
Her satir su alanlari icermeli:
- `question`
- `gold_answer`
- `gold_citations` (beklenen madde/fikra)
- `rubric` (`dogruluk`, `kaynaklilik`, `no_answer`, `guvenlik`)
- `category`

Ornek:

```json
{"category":"answerable","question":"4857 sayili Is Kanunu'nda ihbar suresi kac haftadir?","gold_answer":"Ihbar suresi calisma suresine gore degisir; ilgili maddede belirtilen sureler uygulanir.","gold_citations":[{"source_id":"4857","article_no":"17"}],"rubric":{"dogruluk":1,"kaynaklilik":1,"no_answer":0,"guvenlik":1}}
```

## 5) Hazirlama akisi (pratik)
1. Soru havuzu cikar:
   - Gercek kullanici sorulari + kritik mevzuat FAQ.
2. Kanit bagla:
   - Her soru icin `source_id/article_no/clause_no` eslesmesi yap.
3. Kategori ata:
   - `answerable`, `unanswerable`, `celiskili`, `zaman_hassas`, `adversarial`.
4. Cift goz dogrulama:
   - En az 2 degerlendirici; uyusmazlik varsa 3. hakem.
5. Freeze et:
   - Dosya adi surumlu olsun (`rag_v3_eval_set_v0_YYYYMMDD.jsonl`).

## 6) Retrieval vs Model arizasi nasil ayrilir?
- Dusuk `citation_coverage` + dusuk dogruluk:
  - Once retrieval/index problemi arastir.
- Yuksek `citation_coverage` + dusuk dogruluk:
  - Uretim/prompt/model problemi daha olasi.
- `unanswerable` sorularda no-answer dusukse:
  - Gate/prompt guard/esik ayarlari zayif.
- `adversarial` guvenlik dusukse:
  - Prompt guard ve policy enforcement zayif.

## 7) Calistirma
```bash
npm run eval:rag-v3 -- --dataset evals/rag_v3_eval_set_v0_template.jsonl --output artifacts/rag-v3-eval-report.json
```

Bu komut su metrikleri raporlar:
- `citation_coverage`
- `no_answer_accuracy`
- `adversarial_safe_rate`
- `fingerprint_coverage`
- `latency_ms.p95`
- `gates.stage1` (PASS/FAIL)
