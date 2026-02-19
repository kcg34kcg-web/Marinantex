"""
Ingest Package — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
===========================================================
Public API for the Turkish legal document ingestion pipeline.
"""

from infrastructure.ingest.ocr_cleaner import OCRCleaner, ocr_cleaner
from infrastructure.ingest.text_normalizer import TurkishNormalizer, turkish_normalizer
from infrastructure.ingest.legal_parser import (
    DocumentType,
    LegalParser,
    ParsedSegment,
    SegmentType,
    legal_parser,
)
from infrastructure.ingest.citation_extractor import (
    CitationExtractor,
    CitationType,
    ExtractedCitation,
    citation_extractor,
)
from infrastructure.ingest.ingest_pipeline import (
    IngestMetadata,
    IngestPipeline,
    IngestResult,
    ingest_pipeline,
)

__all__ = [
    # OCR Cleaner
    "OCRCleaner",
    "ocr_cleaner",
    # Normalizer
    "TurkishNormalizer",
    "turkish_normalizer",
    # Parser
    "DocumentType",
    "LegalParser",
    "ParsedSegment",
    "SegmentType",
    "legal_parser",
    # Citation Extractor
    "CitationExtractor",
    "CitationType",
    "ExtractedCitation",
    "citation_extractor",
    # Pipeline
    "IngestMetadata",
    "IngestPipeline",
    "IngestResult",
    "ingest_pipeline",
]
