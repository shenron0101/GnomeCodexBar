"""OpenRouter usage and credit provider."""

import os

import httpx

from usage_tui.providers.base import (
    AuthenticationError,
    BaseProvider,
    ProviderError,
    ProviderName,
    ProviderResult,
    UsageMetrics,
    WindowPeriod,
)


class OpenRouterUsageProvider(BaseProvider):
    """
    Provider for OpenRouter API key usage and limits.

    Environment Variables:
        OPENROUTER_API_KEY: OpenRouter API key

    Official API endpoint:
        - GET /api/v1/key
    """

    name = ProviderName.OPENROUTER
    USAGE_URL = "https://openrouter.ai/api/v1/key"
    TOKEN_ENV_VAR = "OPENROUTER_API_KEY"

    def __init__(self, api_key: str | None = None) -> None:
        """
        Initialize the OpenRouter usage provider.

        Args:
            api_key: API key. If not provided, reads from environment.
        """
        self._api_key = api_key or os.environ.get(self.TOKEN_ENV_VAR)

    def is_configured(self) -> bool:
        """Check if API key is available."""
        return bool(self._api_key)

    def get_config_help(self) -> str:
        """Get configuration instructions."""
        return f"""OpenRouter Usage Provider Configuration:

1. Create an API key in OpenRouter
2. Set environment variable:
   export {self.TOKEN_ENV_VAR}=sk-or-...
"""

    async def fetch(self, window: WindowPeriod = WindowPeriod.DAY_7) -> ProviderResult:
        """Fetch OpenRouter usage and credit data."""
        if not self.is_configured():
            return self._make_error_result(
                window=window,
                error=f"Not configured. Set {self.TOKEN_ENV_VAR} environment variable.",
            )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    self.USAGE_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Accept": "application/json",
                        "User-Agent": "usage-tui",
                    },
                )

                if response.status_code == 401:
                    raise AuthenticationError("Invalid API key")

                if response.status_code == 402:
                    return self._make_error_result(
                        window=window,
                        error="Payment required (negative balance). Add credits.",
                        raw={"status_code": 402, "body": response.text},
                    )

                if response.status_code == 429:
                    return self._make_error_result(
                        window=window,
                        error="Rate limited. Try again later.",
                        raw={"status_code": 429},
                    )

                if response.status_code != 200:
                    return self._make_error_result(
                        window=window,
                        error=f"API error: HTTP {response.status_code}",
                        raw={"status_code": response.status_code, "body": response.text},
                    )

                data = response.json()
                return self._parse_response(data, window)

        except AuthenticationError:
            raise
        except httpx.TimeoutException:
            return self._make_error_result(window=window, error="Request timed out")
        except httpx.RequestError as e:
            return self._make_error_result(window=window, error=f"Network error: {e}")
        except Exception as e:
            raise ProviderError(f"Unexpected error: {e}") from e

    def _parse_response(self, data: dict, window: WindowPeriod) -> ProviderResult:
        """Parse the OpenRouter key response into normalized metrics."""
        payload = data.get("data", {})

        usage = self._get_usage(payload, window)
        cost = usage

        metrics = UsageMetrics(
            cost=cost,
            requests=None,
            input_tokens=None,
            output_tokens=None,
            remaining=payload.get("limit_remaining"),
            limit=payload.get("limit"),
            reset_at=None,
        )

        return ProviderResult(
            provider=self.name,
            window=window,
            metrics=metrics,
            raw=data,
        )

    def _get_usage(self, payload: dict, window: WindowPeriod) -> float:
        """Get usage in credits for the requested window."""
        if window == WindowPeriod.DAY_30:
            return self._to_float(payload.get("usage_monthly"))
        if window == WindowPeriod.HOUR_5:
            return self._to_float(payload.get("usage_daily"))
        return self._to_float(payload.get("usage_weekly"))

    def _get_byok_usage(self, payload: dict, window: WindowPeriod) -> float:
        """Get BYOK usage in credits for the requested window."""
        if window == WindowPeriod.DAY_30:
            return self._to_float(payload.get("byok_usage_monthly"))
        if window == WindowPeriod.HOUR_5:
            return self._to_float(payload.get("byok_usage_daily"))
        return self._to_float(payload.get("byok_usage_weekly"))

    def _to_float(self, value: float | int | None) -> float:
        """Convert optional numeric values to float."""
        if value is None:
            return 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
