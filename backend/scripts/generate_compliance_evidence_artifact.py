from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from application.services.rag_v3_service import rag_v3_service
from domain.entities.tenant import AccessLevel
from infrastructure.config import settings


async def _build_payload() -> dict[str, object]:
    snapshot = await rag_v3_service.get_compliance_evidence_snapshot(
        bureau_id=None,
        access_level=AccessLevel.OWNER,
    )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "rag_v3_global",
        "snapshot": snapshot,
    }


def main() -> int:
    payload = asyncio.run(_build_payload())
    target = Path(str(getattr(settings, "compliance_artifact_output_path", "artifacts/compliance-evidence-report.json") or "artifacts/compliance-evidence-report.json")).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(target))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
