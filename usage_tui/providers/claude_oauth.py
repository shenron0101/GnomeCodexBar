"""Claude OAuth provider for Claude Code subscription quota."""

import os
from datetime import datetime

import httpx

from usage_tui.claude_cli_auth import extract_claude_cli_token
from usage_tui.providers.base import (
    AuthenticationError,
    BaseProvider,
    ProviderError,
    ProviderName,
    ProviderResult,
    UsageMetrics,
    WindowPeriod,
)


class ClaudeProvider(BaseProvider):
    """
    Provider for Claude Code OAuth usage metrics.

    Uses the OAuth token generated via `claude setup-token` to fetch
    subscription quota information.

    Environment Variables:
        CLAUDE_CODE_OAUTH_TOKEN: OAuth token (sk-ant-oat...)

    Note: This endpoint is unofficial and may change. Code parses defensively.
    """

    name = ProviderName.CLAUDE
    USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
    TOKEN_ENV_VAR = "CLAUDE_CODE_OAUTH_TOKEN"

    def __init__(self, token: str | None = None) -> None:
        """
        Initialize the Claude OAuth provider.

        Args:
            token: OAuth token. If not provided, reads from environment,
                   then falls back to Claude CLI credentials.
        """
        self._token = token or os.environ.get(self.TOKEN_ENV_VAR) or extract_claude_cli_token()

    def is_configured(self) -> bool:
        """Check if OAuth token is available."""
        return self._token is not None and self._token.startswith("sk-ant-")

    def get_config_help(self) -> str:
        """Get configuration instructions."""
        return f"""Claude OAuth Provider Configuration:

1. Run: claude setup-token
2. Set environment variable:
   export {self.TOKEN_ENV_VAR}=sk-ant-oat01-...

Note: Token must start with 'sk-ant-' prefix."""

    async def fetch(self, window: WindowPeriod = WindowPeriod.DAY_7) -> ProviderResult:
        """
        Fetch Claude Code subscription quota.

        Note: The window parameter is ignored as Claude's OAuth endpoint
        returns current quota state, not historical data.
        """
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
                        "Authorization": f"Bearer {self._token}",
                        "anthropic-beta": "oauth-2025-04-20",
                        "Accept": "application/json",
                        "User-Agent": "usage-tui",
                    },
                )

                if response.status_code == 401:
                    raise AuthenticationError("Invalid or expired OAuth token")

                if response.status_code == 403:
                    error_body = response.text
                    if "user:profile" in error_body:
                        return self._make_error_result(
                            window=window,
                            error="OAuth scope error. Fix: unset CLAUDE_CODE_OAUTH_TOKEN && claude setup-token",
                            raw={"status_code": 403, "body": error_body},
                        )
                    return self._make_error_result(
                        window=window,
                        error=f"API forbidden: HTTP {response.status_code}",
                        raw={"status_code": 403, "body": error_body},
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
            return self._make_error_result(
                window=window,
                error="Request timed out",
            )
        except httpx.RequestError as e:
            return self._make_error_result(
                window=window,
                error=f"Network error: {e}",
            )
        except Exception as e:
            raise ProviderError(f"Unexpected error: {e}") from e

    def _parse_response(self, data: dict, window: WindowPeriod) -> ProviderResult:
        """
        Parse the API response defensively.

        Expected response format:
        {
            "five_hour": {"utilization": 61.0, "resets_at": "2026-01-28T07:59:59..."},
            "seven_day": {"utilization": 22.0, "resets_at": "2026-02-03T09:59:59..."},
            "extra_usage": {"is_enabled": false, ...}
        }

        utilization is a percentage (0-100) of quota used.
        """
        # Select the appropriate window based on the requested period
        window_key = "seven_day" if window == WindowPeriod.DAY_7 else "five_hour"
        window_data = data.get(window_key, {})

        if not window_data:
            # Fallback to seven_day if specific window not available
            window_data = data.get("seven_day", {})

        # Parse reset time if available
        reset_at = None
        if resets_at := window_data.get("resets_at"):
            try:
                reset_at = datetime.fromisoformat(resets_at.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass

        # Parse utilization percentage (0-100)
        utilization = window_data.get("utilization")
        remaining_percent = None
        if utilization is not None:
            remaining_percent = 100.0 - utilization

        metrics = UsageMetrics(
            remaining=remaining_percent,  # Store as percentage remaining
            limit=100.0,  # Total quota is 100%
            reset_at=reset_at,
            # Claude doesn't provide these in OAuth endpoint
            cost=None,
            requests=None,
            input_tokens=None,
            output_tokens=None,
        )

        return ProviderResult(
            provider=self.name,
            window=window,
            metrics=metrics,
            raw=data,
        )
