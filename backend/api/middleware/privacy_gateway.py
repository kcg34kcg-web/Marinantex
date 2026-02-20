"""
Privacy-First Gateway (CRITICAL LAYER)
Intercepts all requests to mask PII before they reach LLMs or external services.

PRINCIPLES:
1. Zero Trust: Assume all user input contains sensitive data
2. Fail Secure: If masking fails, block the request
3. Reversible: Must be able to restore original data for user display
4. Auditable: Log all PII detection events

FLOW:
User Input → Detect PII → Mask → Process → Unmask → User Output
"""

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response as StarletteResponse
import re
import logging
from typing import Dict, List, Tuple
import uuid

from infrastructure.config import settings
from infrastructure.security.kvkk_redactor import kvkk_redactor

logger = logging.getLogger("babylexit.privacy")


class PrivacyMiddleware(BaseHTTPMiddleware):
    """
    Privacy-First Gateway Middleware
    
    CRITICAL: This MUST be the first middleware in the chain.
    
    For PHASE 1, we use regex-based PII detection (Turkish-specific patterns).
    In PHASE 2, we'll integrate Microsoft Presidio for advanced NER.
    """
    
    def __init__(self, app):
        super().__init__(app)
        
        # PII Pattern Registry (Turkish-specific)
        self.patterns = {
            "tc_id": re.compile(r'\b\d{11}\b'),  # Turkish ID (11 digits)
            "phone": re.compile(r'\b0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b'),  # Turkish mobile
            "email": re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
            "iban": re.compile(r'\bTR\d{24}\b', re.IGNORECASE),
            "address": re.compile(r'\b\d+\.\s+(Sokak|Cadde|Bulvarı?)\b', re.IGNORECASE),
            # Add more patterns as needed
        }
        
        # Masking token storage (in-memory for PHASE 1)
        # TODO: Move to Redis in PHASE 2 for distributed systems
        self.mask_store: Dict[str, Dict[str, str]] = {}
    
    async def dispatch(self, request: Request, call_next):
        """
        Intercepts request/response to apply privacy filtering.
        """
        
        # Skip privacy middleware for certain paths
        if not settings.enable_privacy_middleware or self._should_skip(request):
            return await call_next(request)
        
        # Generate request-specific mask ID
        mask_id = str(uuid.uuid4())
        
        try:
            # 1. Extract request body
            body = await self._get_request_body(request)
            
            if body:
                # 2. Detect and mask PII
                masked_body, mask_map = self._mask_pii(body, mask_id)
                
                # 3. Replace request body with masked version
                request._body = masked_body.encode()
                
                # Log PII detection
                if mask_map:
                    logger.info(
                        f"PII detected in request {mask_id}: "
                        f"{', '.join(f'{k}({v})' for k, v in mask_map.items())}"
                    )
            
            # 4. Process request with masked data
            response = await call_next(request)
            
            # 5. Unmask PII in response (if any)
            if mask_id in self.mask_store:
                response = await self._unmask_response(response, mask_id)
                
                # Clean up mask store
                del self.mask_store[mask_id]
            
            return response
        
        except Exception as e:
            logger.error(f"Privacy middleware error: {e}", exc_info=True)
            
            # Fail secure: Block request if privacy layer fails
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Privacy check failed",
                    "message": "Unable to process request securely. Please contact support.",
                },
            )
    
    def _should_skip(self, request: Request) -> bool:
        """
        Determines if request should skip privacy filtering.
        
        Skip for:
        - Health checks
        - Static assets
        - Admin endpoints (already authenticated)
        """
        path = request.url.path
        
        skip_paths = [
            "/health",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/static",
        ]
        
        return any(path.startswith(p) for p in skip_paths)
    
    async def _get_request_body(self, request: Request) -> str:
        """Extracts request body as string."""
        try:
            body_bytes = await request.body()
            return body_bytes.decode("utf-8")
        except Exception as e:
            logger.warning(f"Failed to read request body: {e}")
            return ""
    
    def _mask_pii(self, text: str, mask_id: str) -> Tuple[str, Dict[str, int]]:
        """
        Detects and masks PII in text.
        
        Args:
            text: Input text
            mask_id: Unique identifier for this masking operation
            
        Returns:
            (masked_text, detection_counts)
        """
        masked_text = text
        mask_map = {}
        detection_counts = {}
        
        for pii_type, pattern in self.patterns.items():
            matches = pattern.findall(text)
            
            if matches:
                detection_counts[pii_type] = len(matches)
                
                for match in matches:
                    # Generate unique mask token
                    mask_token = f"[MASKED_{pii_type.upper()}_{uuid.uuid4().hex[:8]}]"
                    
                    # Store original value for unmasking
                    if mask_id not in self.mask_store:
                        self.mask_store[mask_id] = {}
                    
                    self.mask_store[mask_id][mask_token] = match
                    
                    # Replace in text
                    masked_text = masked_text.replace(match, mask_token, 1)
        
        return masked_text, detection_counts
    
    async def _unmask_response(self, response: Response, mask_id: str) -> Response:
        """
        Restores original PII values in the response body.

        Reads the response body stream, replaces every mask token with its
        original value from self.mask_store, and returns a new Response with
        the same status code, headers, and media type.

        If the mask store has no entries for this request (e.g. no PII was
        detected), the original response is returned unchanged.
        """
        if mask_id not in self.mask_store or not self.mask_store[mask_id]:
            return response

        try:
            # Collect full body — handles both Response (.body) and
            # StreamingResponse (.body_iterator)
            if hasattr(response, "body"):
                body_bytes: bytes = response.body  # type: ignore[attr-defined]
            else:
                chunks: list[bytes] = []
                async for chunk in response.body_iterator:  # type: ignore[attr-defined]
                    chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode("utf-8"))
                body_bytes = b"".join(chunks)

            body_text = body_bytes.decode("utf-8", errors="replace")

            # Replace each mask token with the original PII value
            for mask_token, original_value in self.mask_store[mask_id].items():
                body_text = body_text.replace(mask_token, original_value)

            logger.debug(
                "PRIVACY_UNMASK | mask_id=%s | tokens_restored=%d",
                mask_id[:8],
                len(self.mask_store[mask_id]),
            )

            return StarletteResponse(
                content=body_text.encode("utf-8"),
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        except Exception as exc:
            logger.warning(
                "PRIVACY_UNMASK_FAILED | mask_id=%s | error=%s",
                mask_id[:8], exc,
            )
            return response
    
    def _unmask_text(self, text: str, mask_id: str) -> str:
        """
        Utility method to unmask text (for manual use in handlers).
        """
        if mask_id not in self.mask_store:
            return text
        
        unmasked_text = text
        for mask_token, original_value in self.mask_store[mask_id].items():
            unmasked_text = unmasked_text.replace(mask_token, original_value)
        
        return unmasked_text


# ============================================================================
# Standalone Functions (for manual PII handling)
# ============================================================================

def mask_pii_simple(text: str) -> str:
    """
    Quick PII masking for logging/debugging.  Irreversible — does not store
    a mask map.  Delegates to the canonical KVKKRedactor singleton so that
    all PII detection uses a single, consistent pattern registry.

    Usage:
        safe_line = mask_pii_simple(raw_input)
        logger.info("User query: %s", safe_line)
    """
    return kvkk_redactor.redact_for_log(text)
