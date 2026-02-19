"""
Quick Start Script for Babylexit v3.0 Backend
Validates environment and starts the development server.
"""

import os
import sys
from pathlib import Path


def check_env_file():
    """Check if .env file exists."""
    if not Path(".env").exists():
        print("❌ .env file not found!")
        print("📝 Copy .env.example to .env and fill in your credentials:")
        print("   cp .env.example .env")
        return False
    return True


def check_required_vars():
    """Check if required environment variables are set."""
    from dotenv import load_dotenv
    load_dotenv()
    
    required = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
        "DATABASE_URL",
        "REDIS_URL",
        "PII_ENCRYPTION_KEY",
    ]
    
    missing = [var for var in required if not os.getenv(var)]
    
    if missing:
        print(f"❌ Missing required environment variables:")
        for var in missing:
            print(f"   - {var}")
        return False
    
    return True


def check_redis():
    """Check if Redis is accessible."""
    try:
        import redis
        r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
        r.ping()
        print("✅ Redis connection successful")
        return True
    except Exception as e:
        print(f"❌ Redis connection failed: {e}")
        print("   Start Redis with: docker-compose up -d redis")
        return False


def check_postgres():
    """Check if Postgres is accessible."""
    try:
        import asyncpg
        import asyncio
        
        async def test_connection():
            conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
            await conn.close()
        
        asyncio.run(test_connection())
        print("✅ Postgres connection successful")
        return True
    except Exception as e:
        print(f"❌ Postgres connection failed: {e}")
        print("   Check DATABASE_URL in .env")
        return False


def main():
    """Run all checks and start server if successful."""
    print("🚀 Babylexit v3.0 - Pre-flight Checks\n")
    
    checks = [
        ("Environment file", check_env_file),
        ("Required variables", check_required_vars),
        ("Redis connection", check_redis),
        ("Postgres connection", check_postgres),
    ]
    
    all_passed = True
    for name, check_func in checks:
        print(f"Checking {name}...", end=" ")
        if not check_func():
            all_passed = False
            print()
    
    print()
    
    if all_passed:
        print("🎯 All checks passed! Starting server...\n")
        os.system("uvicorn api.main:app --reload --port 8000")
    else:
        print("❌ Some checks failed. Please fix the issues above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
