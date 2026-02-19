# Desktop OCR Agent Spec (Local-First)

## Runtime
- Python 3.11+
- ONNX Runtime (CPU/GPU)
- PaddleOCR or DocTR backend

## Input
- PDF/image file path
- case_id
- optional page range

## Output
- Per-page OCR text
- token-level bounding boxes
- payload hash (SHA-256)
- processing metadata (engine version, model checksum)

## Security
- Device-local plaintext processing only
- outbound sync payload encrypted with AES-256-GCM
- transport metadata signed with device key

## Sync Contract
- endpoint: `/api/litigation/ingest` (planned)
- message: encrypted envelope + nonce + auth tag + signature

## Audit
- each stage writes chain hash into `evidence_chain_logs`
- final export root committed in `bundle_exports`
