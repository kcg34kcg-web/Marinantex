"""Bearer authentication middleware for protected API paths.

Enforces JWT validation on configured API prefixes when
`auth_enforce_bearer` is enabled. Supports shared-secret (HS*) and
OIDC/JWKS-backed (RS*/ES*) signature verification.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from typing import Any
from typing import Awaitable, Callable

from fastapi import Request, Response
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from infrastructure.config import settings

logger = logging.getLogger("babylexit.auth_middleware")

_SKIP_PATH_PREFIXES: tuple[str, ...] = (
    "/health",
    "/healthz",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
)

_JWKS_CACHE_LOCK = threading.Lock()
_JWKS_CACHE: dict[str, Any] = {
    "url": None,
    "fetched_at": 0.0,
    "payload": None,
}


class AuthMiddleware(BaseHTTPMiddleware):
    """Validate bearer JWT for configured API prefixes."""

    def __init__(self, app) -> None:
        super().__init__(app)
        prefixes = str(getattr(settings, "auth_required_path_prefixes", "") or "")
        parsed = [item.strip() for item in prefixes.split(",") if item.strip()]
        self._protected_prefixes = tuple(parsed)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        path = request.url.path
        request.state.auth_claims = {}
        request.state.auth_subject = None

        if any(path.startswith(prefix) for prefix in _SKIP_PATH_PREFIXES):
            return await call_next(request)

        if not bool(getattr(settings, "auth_enforce_bearer", False)):
            return await call_next(request)

        if not self._protected_prefixes:
            return await call_next(request)

        if not any(path.startswith(prefix) for prefix in self._protected_prefixes):
            return await call_next(request)

        token = _extract_bearer_token(request)
        if not token:
            return _auth_error(
                status=401,
                code="AUTH_REQUIRED",
                message="Authorization: Bearer <token> zorunludur.",
            )

        try:
            claims = _decode_token(token)
        except JWTError as exc:
            logger.warning("AUTH_JWT_INVALID | path=%s | reason=%s", path, exc)
            return _auth_error(
                status=401,
                code="AUTH_INVALID_TOKEN",
                message="Gecersiz veya suresi dolmus token.",
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("AUTH_JWT_PARSE_FAILED | path=%s | reason=%s", path, exc, exc_info=True)
            return _auth_error(
                status=401,
                code="AUTH_INVALID_TOKEN",
                message="Token dogrulanamadi.",
            )

        subject = str(claims.get("sub") or "").strip() or None
        user_header = str(request.headers.get("X-User-ID") or "").strip() or None
        if user_header and subject and user_header != subject:
            return _auth_error(
                status=403,
                code="AUTH_SUBJECT_MISMATCH",
                message="Token sub claim ile X-User-ID uyusmuyor.",
            )

        request.state.auth_claims = claims
        request.state.auth_subject = subject
        return await call_next(request)


def _extract_bearer_token(request: Request) -> str | None:
    header = str(request.headers.get("Authorization") or "").strip()
    if not header:
        return None
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def _decode_token(token: str) -> dict:
    verify_signature = bool(getattr(settings, "auth_verify_jwt_signature", True))
    options = {
        "verify_signature": verify_signature,
        "verify_aud": bool(getattr(settings, "auth_jwt_audience", None)),
        "verify_iss": bool(getattr(settings, "auth_jwt_issuer", None)),
    }
    audience = str(settings.auth_jwt_audience) if getattr(settings, "auth_jwt_audience", None) else None
    issuer = str(settings.auth_jwt_issuer) if getattr(settings, "auth_jwt_issuer", None) else None

    if bool(getattr(settings, "auth_jwt_use_jwks", False)):
        algorithms = _parse_algorithm_csv(
            raw=getattr(settings, "auth_jwks_allowed_algorithms", "RS256"),
            fallback="RS256",
        )
        key: Any = ""
        if verify_signature:
            key = _resolve_jwk_for_token(token)
        return jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience=audience,
            issuer=issuer,
            options=options,
        )

    algorithms = _parse_algorithm_csv(
        raw=getattr(settings, "jwt_algorithm", "HS256"),
        fallback="HS256",
    )
    return jwt.decode(
        token,
        str(getattr(settings, "jwt_secret_key", "") or ""),
        algorithms=algorithms,
        audience=audience,
        issuer=issuer,
        options=options,
    )


def _parse_algorithm_csv(*, raw: object, fallback: str) -> list[str]:
    tokens = [token.strip() for token in str(raw or "").split(",") if token.strip()]
    if not tokens:
        return [fallback]
    return tokens


def _resolve_jwk_for_token(token: str) -> dict[str, Any]:
    header = jwt.get_unverified_header(token)
    if not isinstance(header, dict):
        raise JWTError("invalid_token_header")

    token_alg = str(header.get("alg") or "").strip().upper()
    allowed_algorithms = _parse_algorithm_csv(
        raw=getattr(settings, "auth_jwks_allowed_algorithms", "RS256"),
        fallback="RS256",
    )
    allowed_map = {alg.upper(): alg for alg in allowed_algorithms}
    if token_alg and token_alg not in allowed_map:
        raise JWTError("jwks_alg_not_allowed")

    token_kid = str(header.get("kid") or "").strip() or None
    document = _load_jwks_document(force_refresh=False)
    key = _select_jwk(document=document, kid=token_kid)
    if key is None and token_kid:
        document = _load_jwks_document(force_refresh=True)
        key = _select_jwk(document=document, kid=token_kid)
    if key is None:
        raise JWTError("jwks_key_not_found")
    return key


def _load_jwks_document(*, force_refresh: bool) -> dict[str, Any]:
    jwks_url = str(getattr(settings, "auth_jwks_url", "") or "").strip()
    if not jwks_url:
        raise JWTError("jwks_url_missing")

    ttl = max(0, int(getattr(settings, "auth_jwks_cache_ttl_seconds", 300) or 300))
    now = time.time()

    with _JWKS_CACHE_LOCK:
        cached_url = _JWKS_CACHE.get("url")
        cached_at = float(_JWKS_CACHE.get("fetched_at") or 0.0)
        cached_payload = _JWKS_CACHE.get("payload")
        if (
            not force_refresh
            and cached_url == jwks_url
            and isinstance(cached_payload, dict)
            and (ttl <= 0 or (now - cached_at) <= ttl)
        ):
            return dict(cached_payload)

    timeout_s = float(getattr(settings, "auth_jwks_fetch_timeout_seconds", 3.0) or 3.0)
    fetched = _fetch_jwks_document(jwks_url=jwks_url, timeout_s=timeout_s)

    with _JWKS_CACHE_LOCK:
        _JWKS_CACHE["url"] = jwks_url
        _JWKS_CACHE["fetched_at"] = now
        _JWKS_CACHE["payload"] = fetched
    return dict(fetched)


def _fetch_jwks_document(*, jwks_url: str, timeout_s: float) -> dict[str, Any]:
    request = urllib.request.Request(jwks_url, method="GET")
    request.add_header("Accept", "application/json")
    with urllib.request.urlopen(request, timeout=max(timeout_s, 0.1)) as response:  # noqa: S310
        body = response.read()
    payload = json.loads(body.decode("utf-8"))
    if not isinstance(payload, dict):
        raise JWTError("jwks_invalid_document")
    keys = payload.get("keys")
    if not isinstance(keys, list):
        raise JWTError("jwks_keys_missing")
    return payload


def _select_jwk(*, document: dict[str, Any], kid: str | None) -> dict[str, Any] | None:
    keys = document.get("keys")
    if not isinstance(keys, list):
        return None

    if kid:
        for candidate in keys:
            if not isinstance(candidate, dict):
                continue
            if str(candidate.get("kid") or "").strip() == kid:
                return candidate
        return None

    if len(keys) == 1 and isinstance(keys[0], dict):
        return keys[0]
    return None


def _auth_error(*, status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": code,
            "message": message,
        },
    )
