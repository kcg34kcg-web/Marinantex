"""Auth middleware regression tests for bearer/JWT enforcement."""

from __future__ import annotations

import base64
import json

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from infrastructure.config import settings

pytest.importorskip("jose")
from jose import JWTError, jwt  # noqa: E402
from api.middleware import auth_middleware  # noqa: E402
from api.middleware.auth_middleware import AuthMiddleware  # noqa: E402


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get("/api/v1/rag-v3/query")
    async def protected(request: Request):  # type: ignore[misc]
        return {
            "sub": getattr(request.state, "auth_subject", None),
            "claims": getattr(request.state, "auth_claims", {}),
        }

    return app


def _token(*, sub: str = "user-1") -> str:
    return jwt.encode(
        {"sub": sub},
        str(settings.jwt_secret_key),
        algorithm=str(settings.jwt_algorithm),
    )


def _segment(value: dict[str, str]) -> str:
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _token_with_header(*, header: dict[str, str], payload: dict[str, str]) -> str:
    return f"{_segment(header)}.{_segment(payload)}.signature"


def test_auth_middleware_rejects_missing_bearer(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_enforce_bearer", True)
    monkeypatch.setattr(settings, "auth_required_path_prefixes", "/api/v1/rag-v3")
    monkeypatch.setattr(settings, "auth_verify_jwt_signature", True)
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    response = client.get("/api/v1/rag-v3/query")

    assert response.status_code == 401
    assert response.json()["error"] == "AUTH_REQUIRED"


def test_auth_middleware_allows_valid_bearer(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_enforce_bearer", True)
    monkeypatch.setattr(settings, "auth_required_path_prefixes", "/api/v1/rag-v3")
    monkeypatch.setattr(settings, "auth_verify_jwt_signature", True)
    monkeypatch.setattr(settings, "auth_jwt_issuer", None)
    monkeypatch.setattr(settings, "auth_jwt_audience", None)
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    token = _token(sub="user-42")
    response = client.get(
        "/api/v1/rag-v3/query",
        headers={
            "Authorization": f"Bearer {token}",
            "X-User-ID": "user-42",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sub"] == "user-42"
    assert payload["claims"]["sub"] == "user-42"


def test_auth_middleware_rejects_subject_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_enforce_bearer", True)
    monkeypatch.setattr(settings, "auth_required_path_prefixes", "/api/v1/rag-v3")
    monkeypatch.setattr(settings, "auth_verify_jwt_signature", True)
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    token = _token(sub="user-A")
    response = client.get(
        "/api/v1/rag-v3/query",
        headers={
            "Authorization": f"Bearer {token}",
            "X-User-ID": "user-B",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"] == "AUTH_SUBJECT_MISMATCH"


def test_auth_middleware_uses_jwks_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_enforce_bearer", True)
    monkeypatch.setattr(settings, "auth_required_path_prefixes", "/api/v1/rag-v3")
    monkeypatch.setattr(settings, "auth_verify_jwt_signature", True)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_allowed_algorithms", "RS256")
    monkeypatch.setattr(settings, "auth_jwt_issuer", None)
    monkeypatch.setattr(settings, "auth_jwt_audience", None)

    captured: dict[str, object] = {}

    def _fake_resolve(token: str) -> dict[str, str]:
        captured["resolved_token"] = token
        return {
            "kty": "RSA",
            "kid": "kid-1",
            "alg": "RS256",
            "n": "abc",
            "e": "AQAB",
        }

    def _fake_decode(token: str, key, algorithms, audience=None, issuer=None, options=None):
        captured["decode_token"] = token
        captured["decode_key"] = key
        captured["decode_algorithms"] = list(algorithms)
        return {"sub": "user-jwks"}

    monkeypatch.setattr(auth_middleware, "_resolve_jwk_for_token", _fake_resolve)
    monkeypatch.setattr(auth_middleware.jwt, "decode", _fake_decode)
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    token = _token_with_header(
        header={"alg": "RS256", "kid": "kid-1", "typ": "JWT"},
        payload={"sub": "user-jwks"},
    )
    response = client.get(
        "/api/v1/rag-v3/query",
        headers={
            "Authorization": f"Bearer {token}",
            "X-User-ID": "user-jwks",
        },
    )

    assert response.status_code == 200
    assert response.json()["sub"] == "user-jwks"
    assert captured["resolved_token"] == token
    assert captured["decode_token"] == token
    assert isinstance(captured["decode_key"], dict)
    assert captured["decode_algorithms"] == ["RS256"]


def test_resolve_jwk_rejects_disallowed_alg(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_jwks_allowed_algorithms", "RS256")
    token = _token_with_header(
        header={"alg": "HS256", "kid": "kid-2", "typ": "JWT"},
        payload={"sub": "user-1"},
    )

    with pytest.raises(JWTError):
        auth_middleware._resolve_jwk_for_token(token)
