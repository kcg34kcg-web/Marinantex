from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional


@dataclass(frozen=True)
class MatterScopeViolation(Exception):
    route: str
    reason: str

    def to_detail(self) -> dict[str, str]:
        return {
            "error_code": "MATTER_SCOPE_MISMATCH",
            "route": self.route,
            "reason": self.reason,
        }


def _normalize(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    token = str(value).strip()
    return token or None


def resolve_requested_matter_id(headers: Mapping[str, object]) -> Optional[str]:
    x_matter_id = headers.get("x-matter-id") or headers.get("X-Matter-ID")
    x_case_id = headers.get("x-case-id") or headers.get("X-Case-ID")
    return _normalize(str(x_matter_id) if isinstance(x_matter_id, str) else None) or _normalize(
        str(x_case_id) if isinstance(x_case_id, str) else None
    )


def assert_matter_scope(
    *,
    route: str,
    requested_matter_id: Optional[str],
    payload_matter_id: Optional[str] = None,
    resource_matter_id: Optional[str] = None,
) -> None:
    requested = _normalize(requested_matter_id)
    payload = _normalize(payload_matter_id)
    resource = _normalize(resource_matter_id)

    if requested and payload and requested != payload:
        raise MatterScopeViolation(route=route, reason="header_payload_mismatch")

    if requested and resource and requested != resource:
        raise MatterScopeViolation(route=route, reason="header_resource_mismatch")
