from __future__ import annotations

import pytest

from infrastructure.security.matter_scope import (
    MatterScopeViolation,
    assert_matter_scope,
    resolve_requested_matter_id,
)


def test_resolve_requested_matter_id_prefers_x_matter_id() -> None:
    headers = {"x-matter-id": "matter-1", "x-case-id": "case-1"}
    assert resolve_requested_matter_id(headers) == "matter-1"


def test_resolve_requested_matter_id_falls_back_to_case_header() -> None:
    headers = {"x-case-id": "case-1"}
    assert resolve_requested_matter_id(headers) == "case-1"


def test_assert_matter_scope_allows_equal_values() -> None:
    assert_matter_scope(
        route="/api/v1/rag/query",
        requested_matter_id="case-1",
        payload_matter_id="case-1",
        resource_matter_id="case-1",
    )


def test_assert_matter_scope_raises_for_header_payload_mismatch() -> None:
    with pytest.raises(MatterScopeViolation) as exc:
        assert_matter_scope(
            route="/api/v1/rag/query",
            requested_matter_id="case-1",
            payload_matter_id="case-2",
        )

    assert exc.value.reason == "header_payload_mismatch"


def test_assert_matter_scope_raises_for_header_resource_mismatch() -> None:
    with pytest.raises(MatterScopeViolation) as exc:
        assert_matter_scope(
            route="/api/v1/rag/thread",
            requested_matter_id="case-1",
            resource_matter_id="case-2",
        )

    assert exc.value.reason == "header_resource_mismatch"
