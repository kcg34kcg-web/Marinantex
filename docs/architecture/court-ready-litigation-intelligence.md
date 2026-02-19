# Court-Ready Litigation Intelligence (TR/EN Blueprint)

## 1) Local-First Hybrid Processing
- OCR pipeline is designed for Desktop Agent (Python + ONNX).
- Recommended engines: PaddleOCR / DocTR.
- Sync boundary: only encrypted artifacts leave local machine.

## 2) WebGL Graph Layer
- Rendering target: Cosmograph (PixiJS).
- Worker-first layout for force simulation (60fps target under high edge load).
- Temporal node model supports `factual_occurrence_date` and `epistemic_discovery_date`.

## 3) Neuro-Symbolic Extraction Pipeline
1. LLM extracts triples with confidence score.
2. Confidence > 95% auto-commit to graph store.
3. Low confidence routed to `extraction_staging` for human verification.

## 4) Contradiction Detection Cost Control
- Phase A: semantic candidate filtering by vector similarity.
- Phase B: NLI cross-encoder only on filtered candidates.
- Output labels: entailment / neutral / contradiction.

## 5) Evidence Integrity & Bates
- Global immutable exhibit ID stored separately from presentation Bates ID.
- Vacated / omitted slots preserved with stable references.
- Chain-of-custody hash from OCR -> extraction -> graph -> export.
- Bundle hash generated via SHA-256 and auditable in `bundle_exports`.

## 6) Limitation Liability Shield
- Engine distinguishes tolling/suspension and interruption events.
- Every deadline response is tagged as advisory/estimated.
- UI enforces explicit "Accept & Verify" action before persistence.

## 7) Jurisdictional Diff
- Rule packs stored in `jurisdiction_rule_sets`.
- Turkish and Swiss variants can be compared by versioned config.

## 8) Next Integration Steps
- Add Cosmograph graph view in `/cases/[id]/intelligence`.
- Add dedicated Desktop Agent secure gRPC channel.
- Add E2EE channel key management and device-bound key rotation.
