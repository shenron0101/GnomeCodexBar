"""Base provider interface and normalized output contract."""

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class WindowPeriod(str, Enum):
    """Supported time windows for usage queries."""

    HOUR_5 = "5h"
    DAY_7 = "7d"
    DAY_30 = "30d"


class ProviderName(str, Enum):
    """Supported provider names."""

    CLAUDE = "claude"
    OPENAI = "openai"
    OPENROUTER = "openrouter"
    COPILOT = "copilot"
    CODEX = "codex"
    GOOGLE = "google"


class UsageMetrics(BaseModel):
    """Normalized usage metrics across all providers."""

    cost: float | None = Field(default=None, description="Total cost in USD")
    requests: int | None = Field(default=None, description="Number of API requests")
    input_tokens: int | None = Field(default=None, description="Total input tokens")
    output_tokens: int | None = Field(default=None, description="Total output tokens")
    remaining: float | None = Field(default=None, description="Remaining quota/budget")
    limit: float | None = Field(default=None, description="Total quota/budget limit")
    reset_at: datetime | None = Field(default=None, description="When quota resets")

    @property
    def usage_percent(self) -> float | None:
        """Calculate usage percentage if limit is available."""
        if self.limit is None or self.limit == 0:
            return None
        if self.remaining is not None:
            return ((self.limit - self.remaining) / self.limit) * 100
        return None

    @property
    def total_tokens(self) -> int | None:
        """Calculate total tokens if both input and output are available."""
        if self.input_tokens is None and self.output_tokens is None:
            return None
        return (self.input_tokens or 0) + (self.output_tokens or 0)


class ProviderResult(BaseModel):
    """Normalized result from any provider."""

    provider: ProviderName
    window: WindowPeriod
    metrics: UsageMetrics
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    raw: dict[str, Any] = Field(default_factory=dict, description="Raw API response")
    error: str | None = Field(default=None, description="Error message if fetch failed")

    @property
    def is_error(self) -> bool:
        """Check if this result represents an error."""
        return self.error is not None


class ProviderError(Exception):
    """Base exception for provider errors."""

    pass


class AuthenticationError(ProviderError):
    """Raised when authentication fails."""

    pass


class RateLimitError(ProviderError):
    """Raised when rate limited."""

    pass


class BaseProvider(ABC):
    """Abstract base class for usage providers."""

    name: ProviderName

    @abstractmethod
    async def fetch(self, window: WindowPeriod = WindowPeriod.DAY_7) -> ProviderResult:
        """
        Fetch usage metrics for the given time window.

        Args:
            window: Time period to fetch metrics for

        Returns:
            Normalized ProviderResult with metrics

        Raises:
            AuthenticationError: If authentication fails
            ProviderError: For other provider-specific errors
        """
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """
        Check if the provider is properly configured (has required credentials).

        Returns:
            True if provider can be used, False otherwise
        """
        pass

    @abstractmethod
    def get_config_help(self) -> str:
        """
        Get help text for configuring this provider.

        Returns:
            Human-readable configuration instructions
        """
        pass

    def _make_error_result(
        self, window: WindowPeriod, error: str, raw: dict[str, Any] | None = None
    ) -> ProviderResult:
        """Helper to create an error result."""
        return ProviderResult(
            provider=self.name,
            window=window,
            metrics=UsageMetrics(),
            error=error,
            raw=raw or {},
        )
