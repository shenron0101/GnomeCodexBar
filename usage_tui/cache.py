"""Caching layer for provider results."""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from usage_tui.providers.base import ProviderName, ProviderResult, WindowPeriod


class CacheEntry(BaseModel):
    """A cached provider result with metadata."""

    result: ProviderResult
    cached_at: datetime
    ttl_seconds: int

    def is_expired(self) -> bool:
        """Check if this cache entry has expired."""
        now = datetime.now(timezone.utc)
        cached_at_utc = self.cached_at.replace(tzinfo=timezone.utc)
        return now > cached_at_utc + timedelta(seconds=self.ttl_seconds)


class ResultCache:
    """
    In-memory and disk cache for provider results.

    Features:
    - Configurable TTL per provider
    - Disk persistence for last good result
    - Never logs or persists tokens
    """

    DEFAULT_TTL = 120  # 2 minutes
    PROVIDER_TTLS = {
        ProviderName.CLAUDE: 60,  # 1 minute - quota changes quickly
        ProviderName.GEMINI: 60,  # 1 minute - quota changes quickly
        ProviderName.OPENAI: 180,  # 3 minutes - usage data is historical
        ProviderName.OPENROUTER: 180,  # 3 minutes - credits update periodically
        ProviderName.COPILOT: 300,  # 5 minutes - reports are slow to update
    }

    def __init__(self, cache_dir: Path | None = None) -> None:
        """
        Initialize the cache.

        Args:
            cache_dir: Directory for disk persistence.
                      Defaults to ~/.cache/usage-tui/
        """
        self._memory_cache: dict[str, CacheEntry] = {}
        self._cache_dir = cache_dir or self._default_cache_dir()
        self._ensure_cache_dir()

    def _default_cache_dir(self) -> Path:
        """Get default cache directory following XDG spec."""
        xdg_cache = os.environ.get("XDG_CACHE_HOME")
        base = Path(xdg_cache) if xdg_cache else Path.home() / ".cache"
        return base / "usage-tui"

    def _ensure_cache_dir(self) -> None:
        """Create cache directory if it doesn't exist."""
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_key(self, provider: ProviderName, window: WindowPeriod) -> str:
        """Generate cache key for provider/window combination."""
        return f"{provider.value}:{window.value}"

    def _disk_path(self, provider: ProviderName, window: WindowPeriod) -> Path:
        """Get disk cache path for provider/window."""
        return self._cache_dir / f"{provider.value}_{window.value}.json"

    def get(self, provider: ProviderName, window: WindowPeriod) -> ProviderResult | None:
        """
        Get cached result if available and not expired.

        First checks memory cache, then falls back to disk.
        """
        key = self._cache_key(provider, window)

        # Check memory cache first
        if entry := self._memory_cache.get(key):
            if not entry.is_expired():
                return entry.result
            del self._memory_cache[key]

        # Fall back to disk cache
        return self._load_from_disk(provider, window)

    def set(self, result: ProviderResult) -> None:
        """
        Cache a provider result in memory and on disk.

        Only successful results (no error) are persisted to disk.
        """
        key = self._cache_key(result.provider, result.window)
        ttl = self.PROVIDER_TTLS.get(result.provider, self.DEFAULT_TTL)

        entry = CacheEntry(
            result=result,
            cached_at=datetime.now(timezone.utc),
            ttl_seconds=ttl,
        )
        self._memory_cache[key] = entry

        # Persist to disk if successful
        if not result.is_error:
            self._save_to_disk(result)

    def get_last_good(self, provider: ProviderName, window: WindowPeriod) -> ProviderResult | None:
        """
        Get the last successful result from disk, regardless of TTL.

        Useful for showing stale data when API is unavailable.
        """
        return self._load_from_disk(provider, window, ignore_ttl=True)

    def invalidate(
        self, provider: ProviderName | None = None, window: WindowPeriod | None = None
    ) -> None:
        """
        Invalidate cached entries.

        Args:
            provider: If set, only invalidate entries for this provider
            window: If set, only invalidate entries for this window
        """
        if provider is None and window is None:
            # Clear all
            self._memory_cache.clear()
            return

        keys_to_remove = []
        for key in self._memory_cache:
            p, w = key.split(":")
            if (provider is None or p == provider.value) and (window is None or w == window.value):
                keys_to_remove.append(key)

        for key in keys_to_remove:
            del self._memory_cache[key]

    def _save_to_disk(self, result: ProviderResult) -> None:
        """Save result to disk cache."""
        path = self._disk_path(result.provider, result.window)
        try:
            # Sanitize raw data to remove any potential tokens
            sanitized = result.model_copy(deep=True)
            sanitized.raw = self._sanitize_raw(sanitized.raw)

            with open(path, "w") as f:
                f.write(sanitized.model_dump_json(indent=2))
        except (OSError, IOError):
            # Silently fail on disk write errors
            pass

    def _load_from_disk(
        self,
        provider: ProviderName,
        window: WindowPeriod,
        ignore_ttl: bool = False,
    ) -> ProviderResult | None:
        """Load result from disk cache."""
        path = self._disk_path(provider, window)
        if not path.exists():
            return None

        try:
            with open(path) as f:
                data = json.load(f)
            result = ProviderResult.model_validate(data)

            if ignore_ttl:
                return result

            # Check if disk cache is still valid
            ttl = self.PROVIDER_TTLS.get(provider, self.DEFAULT_TTL)
            age = datetime.now(timezone.utc) - result.updated_at.replace(tzinfo=timezone.utc)
            if age.total_seconds() <= ttl:
                return result

            return None
        except (OSError, IOError, json.JSONDecodeError, ValueError):
            return None

    def _sanitize_raw(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Remove any potential sensitive data from raw response."""
        sensitive_keys = {"token", "key", "secret", "password", "authorization"}

        def clean(obj: Any) -> Any:
            if isinstance(obj, dict):
                return {
                    k: "[REDACTED]" if k.lower() in sensitive_keys else clean(v)
                    for k, v in obj.items()
                }
            elif isinstance(obj, list):
                return [clean(item) for item in obj]
            return obj

        return clean(raw)
