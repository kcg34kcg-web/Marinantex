"""
infrastructure/database
=======================
Supabase bağlantısı ve concrete repository implementasyonları.

Concrete Repositories:
    SupabaseAuditRepository    — IAuditRepository  (Step 17 DB persistence)
    SupabaseDocumentRepository — IDocumentRepository (Ingest + Search)
    SupabaseCitationRepository — ICitationRepository (GraphRAG edges)
"""

from infrastructure.database.supabase_audit_repository import (
    SupabaseAuditRepository,
    supabase_audit_repository,
)
from infrastructure.database.supabase_document_repository import (
    SupabaseDocumentRepository,
    supabase_document_repository,
)
from infrastructure.database.supabase_citation_repository import (
    SupabaseCitationRepository,
    supabase_citation_repository,
)

__all__ = [
    "SupabaseAuditRepository",
    "supabase_audit_repository",
    "SupabaseDocumentRepository",
    "supabase_document_repository",
    "SupabaseCitationRepository",
    "supabase_citation_repository",
]
