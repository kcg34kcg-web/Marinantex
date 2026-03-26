# RAG v3 Model Serving Layer (Qwen)

Bu not, Qwen serving katmaninin router'dan ayrik olarak nasil konumlandirildigini ve vLLM/SGLang secim matrisi kararini dokumante eder.

## 1) Katman Ayrimi

- Planner: retrieval stratejisini belirler (`backend/infrastructure/rag_v3/planner.py`)
- Router: provider/model secer (`backend/infrastructure/llm/tiered_router.py`)
- Serving Layer: self-host backend konfiguru ve health probe (`backend/infrastructure/serving/qwen_deployment.py`)

`rag_v3_service` query trace metadata'sina su alanlari yazar:
- `qwen_serving_backend`
- `qwen_serving_base_url`

## 2) Benchmark Karar Matrisi (vLLM vs SGLang)

| Workload | vLLM | SGLang | Not |
|---|---|---|---|
| Duz metin QA (kisa context) | Guclu | Orta | vLLM throughput/latency dengesi iyi |
| Uzun context + coklu concurrent | Guclu | Orta | vLLM paged attention avantajli |
| Custom decode akislari | Orta | Guclu | SGLang DSL tabanli decode kontrolu daha esnek |
| Hizli POC / OpenAI-compatible drop-in | Guclu | Orta | vLLM kurulum ve OpenAI uyumu pratik |
| Tool-heavy orchestration denemeleri | Orta | Guclu | SGLang is akisi seviyesinde daha programlanabilir |

## 3) Uretim Varsayimi

- Varsayilan backend: `qwen_serving_backend=auto`
- `auto` secim kurali:
  - `SGLANG_BASE_URL` varsa `sglang`
  - aksi halde `OPENAI_BASE_URL`/local endpoint ile `vllm`

## 4) Operasyon Notlari

- Health probe: `probe_qwen_backend_health(...)`
- Router fallback aktifken serving katmani down olsa da RAG no-answer/extractive fallback davranisi korunur.
- Serving degisikliklerinde retrieval/citation gate'leri (claim + policy) degismez; sadece generation backend degisir.

