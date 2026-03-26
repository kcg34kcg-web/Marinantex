#!/usr/bin/env python3
"""Seed runtime evidence for ictihat coverage and thinking-lane trace."""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date
from pathlib import Path
from uuid import UUID

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from application.services.rag_v3_service import (  # noqa: E402
    RagV3IngestCommand,
    RagV3QueryCommand,
    RagV3Service,
)
from domain.entities.tenant import AccessLevel  # noqa: E402


DEFAULT_BUREAU_ID = "550e8400-e29b-41d4-a716-446655440000"


def _ictihat_seed_command() -> RagV3IngestCommand:
    return RagV3IngestCommand(
        title="Yargitay 9. Hukuk Dairesi Kidem Tazminati Karari",
        source_type="ictihat",
        source_id="yargitay://9hd/2020-111/2021-222",
        jurisdiction="TR",
        raw_text=(
            "YARGITAY 9. HUKUK DAIRESI\n"
            "ESAS NO: 2020/111\n"
            "KARAR NO: 2021/222\n"
            "KARAR TARIHI: 15.03.2021\n\n"
            "OLAY:\n"
            "Davaci isci kidem tazminati talep etmistir.\n\n"
            "GEREKCE:\n"
            "Is sozlesmesinin haksiz feshi halinde kidem tazminati odemesi gerekir.\n\n"
            "SONUC:\n"
            "Davacinin kidem tazminati talebinin kabulune karar verilmistir."
        ),
        classification="PUBLIC",
        effective_from=date(2021, 3, 15),
        acl_tags=["public", "judiciary"],
        metadata={
            "authority_type": "ICTIHAT",
            "authority_rank": 85,
            "canonical_citation": "Yargitay 9. HD E.2020/111 K.2021/222",
            "court": "Yargitay",
            "chamber": "9. Hukuk Dairesi",
            "esas_no": "2020/111",
            "karar_no": "2021/222",
            "decision_date": "2021-03-15",
            "topic_tags": ["is_hukuku", "ictihat"],
            "source_url": "https://karararama.yargitay.gov.tr/",
            "source_scope": "national",
        },
    )


async def _run(args: argparse.Namespace) -> int:
    bureau_id = UUID(args.bureau_id)
    service = RagV3Service()

    ingest_result = await service.ingest(
        _ictihat_seed_command(),
        bureau_id=bureau_id,
        access_level=AccessLevel.OWNER,
    )
    print(
        "[seed-evidence] ingest_ok "
        f"document_id={ingest_result.document_id} chunk_count={ingest_result.chunk_count}"
    )

    thinking_query = RagV3QueryCommand(
        query=(
            "Yargitay 9. HD E.2020/111 K.2021/222 ve benzer kararlarda "
            "celiski/catisma var mi? Adim adim karsi gorus stratejisiyle analiz et."
        ),
        top_k=10,
        jurisdiction="TR",
        requested_tier=3,
        acl_tags=["public", "judiciary"],
        legal_disclaimer_ack=True,
        human_responsibility_ack=True,
        selected_mode="coverage_evidence_seed",
        policy_context={"purpose_of_use": "audit_evidence_seed"},
    )
    thinking_result = await service.query(
        thinking_query,
        bureau_id=bureau_id,
        access_level=AccessLevel.OWNER,
    )
    print(
        "[seed-evidence] thinking_trace_ok "
        f"request_id={thinking_result.request_id} "
        f"effective_tier={thinking_result.admission.effective_tier} "
        f"model={thinking_result.fingerprint.model_version}"
    )

    instruct_query = RagV3QueryCommand(
        query="Kidem tazminati nedir?",
        top_k=8,
        jurisdiction="TR",
        requested_tier=2,
        acl_tags=["public"],
        legal_disclaimer_ack=True,
        human_responsibility_ack=True,
        selected_mode="coverage_evidence_seed",
        policy_context={"purpose_of_use": "audit_evidence_seed"},
    )
    instruct_result = await service.query(
        instruct_query,
        bureau_id=bureau_id,
        access_level=AccessLevel.OWNER,
    )
    print(
        "[seed-evidence] instruct_trace_ok "
        f"request_id={instruct_result.request_id} "
        f"effective_tier={instruct_result.admission.effective_tier} "
        f"model={instruct_result.fingerprint.model_version}"
    )

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed ictihat + model-lane evidence.")
    parser.add_argument(
        "--bureau-id",
        default=DEFAULT_BUREAU_ID,
        help="Target bureau UUID for ingest/query traces.",
    )
    args = parser.parse_args()
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
