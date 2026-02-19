"""
Configuration Management for Babylexit v3.0
Loads environment variables with validation and type safety.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    Uses Pydantic for validation and type safety.
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    # ========================================================================
    # Database (Supabase)
    # ========================================================================
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_anon_key: Optional[str] = None
    database_url: str = ""  # Direct Postgres connection for checkpointer
    
    # ========================================================================
    # Redis
    # ========================================================================
    redis_url: str = "redis://localhost:6379"
    redis_password: Optional[str] = None
    
    # ========================================================================
    # LLM Providers
    # ========================================================================
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    
    # ========================================================================
    # Privacy & Security
    # ========================================================================
    pii_encryption_key: str = ""
    jwt_secret_key: str = "dev-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 30
    
    # ========================================================================
    # Application
    # ========================================================================
    environment: str = "development"
    log_level: str = "info"
    debug: bool = False
    
    # Rate limiting
    rate_limit_per_minute: int = 60
    rate_limit_burst: int = 10
    
    # ========================================================================
    # Embeddings & Models
    # ========================================================================
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
    embedding_dimension: int = 768
    turkish_ner_model: Optional[str] = None
    
    # ========================================================================
    # LangGraph
    # ========================================================================
    checkpoint_table_name: str = "langgraph_checkpoints"
    
    # ========================================================================
    # Feature Flags
    # ========================================================================
    enable_privacy_middleware: bool = True
    enable_semantic_router: bool = True
    enable_time_travel: bool = False
    enable_citation_engine: bool = False
    enable_living_documents: bool = False
    
    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment.lower() == "production"
    
    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment.lower() == "development"


# Global settings instance
settings = Settings()
