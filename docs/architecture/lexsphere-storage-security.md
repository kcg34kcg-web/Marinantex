# LexSphere Storage & Security Baseline

## 1) Object Storage Topology
- Bucket `office-documents` (private): all uploaded originals.
- Bucket `office-derivatives` (private): OCR text, thumbnails, redacted copies.
- Bucket `office-exports` (private, short-lived URLs): generated PDF/ZIP exports.

## 2) Versioning & Retention
- Enable versioning on all buckets.
- Lifecycle policy:
  - Current versions: no automatic delete.
  - Non-current versions: transition to low-cost tier at day 30.
  - Non-current delete: day 3650 (10 years) unless legal hold exists.
- Legal hold metadata key: `legal_hold=true` blocks deletion jobs.

## 3) Encryption & Keys
- Server-side encryption required (SSE-S3 minimum, SSE-KMS preferred).
- Key rotation every 12 months.
- Access logs immutable and retained at least 2 years.

## 4) Security Controls (OWASP / KVKK / GDPR aligned)
- Short-lived signed URLs only (max 10 minutes).
- No public ACL.
- File type validation + MIME sniffing + malware scan pipeline.
- PII minimization in AI prompts (existing scrubber pipeline).
- Data subject deletion workflow must preserve statutory litigation archive obligations.

## 5) Audit and Traceability
- Store per-access audit: user, role, IP, object key, operation, timestamp.
- Intern role downloads stamped with watermark (name + datetime + IP).
- Chain-of-custody hash should be appended after each derived artifact write.

## 6) Operational Checklist
1. Enable bucket versioning.
2. Add lifecycle policy JSON from infra repository.
3. Configure KMS key and IAM least-privilege roles.
4. Connect upload webhooks to OCR pipeline.
5. Verify signed URL expiry and access revocation tests.
