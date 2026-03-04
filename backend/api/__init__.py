"""
Initialize API package
"""

from enum import Enum

__version__ = "3.0.0"


class ChatMode(str, Enum):
    """Product-level chat modes shared across API schemas/routes."""

    GENERAL_CHAT = "general_chat"
    DOCUMENT_ANALYSIS = "document_analysis"


class ResponseType(str, Enum):
    """
    Mandatory response classification — every RAG response MUST carry one.

    LEGAL_GROUNDED   → Kaynaklı Hukuki Yanıt (at least 1 citation required)
    SOCIAL_UNGROUNDED → Sosyal / Kaynaksız Yanıt (simple social chat only)
    """

    LEGAL_GROUNDED = "legal_grounded"
    SOCIAL_UNGROUNDED = "social_ungrounded"


class AITier(str, Enum):
    """User-facing intelligence tier selection."""

    HAZIR_CEVAP = "hazir_cevap"
    DUSUNCELI = "dusunceli"
    UZMAN = "uzman"
    MUAZZAM = "muazzam"


class ResponseDepth(str, Enum):
    """Requested depth for answer style/length."""

    SHORT = "short"
    STANDARD = "standard"
    DETAILED = "detailed"


class SaveMode(str, Enum):
    """Output persistence strategy requested by the client."""

    OUTPUT_ONLY = "output_only"
    OUTPUT_WITH_THREAD = "output_with_thread"
    OUTPUT_WITH_THREAD_AND_SOURCES = "output_with_thread_and_sources"


class SaveTarget(str, Enum):
    """User-facing save target selection."""

    MY_FILES = "my_files"
    EXISTING_CASE = "existing_case"
    NEW_CASE = "new_case"


class ClientAction(str, Enum):
    """Optional client-facing rewrite/save action."""

    NONE = "none"
    TRANSLATE_FOR_CLIENT_DRAFT = "translate_for_client_draft"
    SAVE_CLIENT_DRAFT = "save_client_draft"
