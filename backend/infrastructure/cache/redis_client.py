"""
Redis Client for Caching & Pub/Sub
Used for temporary data only (NOT for state persistence).
"""

import redis.asyncio as redis
from typing import Optional, Any
import json
import logging

from infrastructure.config import settings

logger = logging.getLogger("babylexit.redis")


class RedisClient:
    """
    Async Redis client wrapper.
    
    Usage:
        - Cache: Store/retrieve temporary data (embeddings, API responses)
        - Pub/Sub: Real-time notifications (agent progress updates)
    
    CRITICAL: Redis is NOT used for persistent state. All important data
    goes to Postgres via LangGraph checkpointer.
    """
    
    def __init__(self):
        self.client: Optional[redis.Redis] = None
        self._pubsub: Optional[redis.client.PubSub] = None
    
    async def connect(self):
        """Establishes connection to Redis server."""
        if self.client is None:
            logger.info(f"Connecting to Redis at {settings.redis_url}...")
            
            self.client = await redis.from_url(
                settings.redis_url,
                password=settings.redis_password,
                encoding="utf-8",
                decode_responses=True,
                max_connections=50,
            )
            
            # Test connection
            await self.client.ping()
            logger.info("✅ Redis connected successfully")
    
    async def disconnect(self):
        """Closes Redis connection."""
        if self.client is not None:
            logger.info("Closing Redis connection...")
            await self.client.close()
            self.client = None
            logger.info("✅ Redis disconnected")
    
    # ========================================================================
    # Cache Operations
    # ========================================================================
    
    async def get(self, key: str) -> Optional[Any]:
        """
        Retrieves value from cache.
        
        Args:
            key: Cache key
            
        Returns:
            Cached value or None if not found
        """
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        value = await self.client.get(key)
        if value is not None:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return None
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: int = 3600,  # 1 hour default
    ) -> bool:
        """
        Stores value in cache with TTL.
        
        Args:
            key: Cache key
            value: Value to store (will be JSON-serialized)
            ttl: Time to live in seconds
            
        Returns:
            True if successful
        """
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        serialized = json.dumps(value) if not isinstance(value, str) else value
        return await self.client.setex(key, ttl, serialized)
    
    async def delete(self, key: str) -> bool:
        """Deletes key from cache."""
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        return await self.client.delete(key) > 0
    
    async def exists(self, key: str) -> bool:
        """Checks if key exists in cache."""
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        return await self.client.exists(key) > 0
    
    # ========================================================================
    # Pub/Sub Operations (for real-time agent progress)
    # ========================================================================
    
    async def publish(self, channel: str, message: dict) -> int:
        """
        Publishes message to channel.
        
        Args:
            channel: Channel name (e.g., "agent:progress:user_123")
            message: Message to publish
            
        Returns:
            Number of subscribers that received the message
        """
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        return await self.client.publish(channel, json.dumps(message))
    
    async def subscribe(self, channel: str):
        """
        Subscribes to channel (yields messages).
        
        Usage:
            async for message in redis.subscribe("agent:progress:user_123"):
                print(message)
        """
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        if self._pubsub is None:
            self._pubsub = self.client.pubsub()
        
        await self._pubsub.subscribe(channel)
        
        try:
            async for message in self._pubsub.listen():
                if message["type"] == "message":
                    yield json.loads(message["data"])
        finally:
            await self._pubsub.unsubscribe(channel)
    
    # ========================================================================
    # Utility Methods
    # ========================================================================
    
    async def flush_all(self):
        """Clears entire cache (use with caution!)."""
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        await self.client.flushall()
        logger.warning("⚠️ Redis cache cleared (FLUSHALL)")
    
    async def get_info(self) -> dict:
        """Returns Redis server info."""
        if self.client is None:
            raise RuntimeError("Redis client not connected")
        
        return await self.client.info()
