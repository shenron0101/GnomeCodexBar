"""OpenAI Codex provider for usage metrics."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


class CodexCredentials:
    """
    Credentials for OpenAI Codex OAuth.

    Reads from ~/.codex/auth.json (or $CODEX_HOME/auth.json)
    """

    def __init__(
        self,
        access_token: str,
        refresh_token: str = "",
        id_token: str = "",
        account_id: str | None = None,
        last_refresh: datetime | None = None,
    ) -> None:
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.id_token = id_token
        self.account_id = account_id
        self.last_refresh = last_refresh or datetime.now(timezone.utc)

    def needs_refresh(self) -> bool:
        """Check if token needs refresh (older than 8 days)."""
        if not self.refresh_token:
            return False
        age = datetime.now(timezone.utc) - self.last_refresh
        return age.days >= 8

    @classmethod
    def from_auth_json(cls, data: dict) -> "CodexCredentials":
        """Parse credentials from auth.json format."""
        last_refresh = None
        if lr := data.get("last_refresh"):
            try:
                if isinstance(lr, str):
                    last_refresh = datetime.fromisoformat(lr.replace("Z", "+00:00"))
                elif isinstance(lr, (int, float)):
                    last_refresh = datetime.fromtimestamp(lr, tz=timezone.utc)
            except Exception:
                pass

        return cls(
            access_token=data.get("access_token", ""),
            refresh_token=data.get("refresh_token", ""),
            id_token=data.get("id_token", ""),
            account_id=data.get("account_id"),
            last_refresh=last_refresh,
        )


class CodexCredentialStore:
    """
    Store and retrieve Codex credentials from ~/.codex/auth.json.
    """

    @property
    def codex_home(self) -> Path:
        """Get Codex home directory."""
        if env_home := os.environ.get("CODEX_HOME"):
            return Path(env_home)
        return Path.home() / ".codex"

    @property
    def auth_file(self) -> Path:
        """Get auth.json path."""
        return self.codex_home / "auth.json"

    def load(self) -> CodexCredentials | None:
        """Load credentials from auth.json."""
        # First check environment variable
        if token := os.environ.get("CODEX_ACCESS_TOKEN"):
            return CodexCredentials(access_token=token)

        # Then check auth.json
        if not self.auth_file.exists():
            return None

        try:
            data = json.loads(self.auth_file.read_text())

            # Handle nested 'tokens' structure (Codex CLI format)
            tokens = data.get("tokens", {})
            if tokens:
                last_refresh = None
                if lr := data.get("last_refresh"):
                    try:
                        last_refresh = datetime.fromisoformat(lr.replace("Z", "+00:00"))
                    except Exception:
                        pass

                return CodexCredentials(
                    access_token=tokens.get("access_token", ""),
                    refresh_token=tokens.get("refresh_token", ""),
                    id_token=tokens.get("id_token", ""),
                    account_id=tokens.get("account_id"),
                    last_refresh=last_refresh,
                )

            # Fallback to flat structure
            return CodexCredentials.from_auth_json(data)
        except Exception:
            return None

    def save(self, credentials: CodexCredentials) -> None:
        """Save credentials to auth.json."""
        self.codex_home.mkdir(parents=True, exist_ok=True)

        # Use the nested format to match Codex CLI
        data = {
            "OPENAI_API_KEY": None,
            "tokens": {
                "access_token": credentials.access_token,
                "refresh_token": credentials.refresh_token,
                "id_token": credentials.id_token,
                "account_id": credentials.account_id,
            },
            "last_refresh": credentials.last_refresh.isoformat()
            if credentials.last_refresh
            else None,
        }
        self.auth_file.write_text(json.dumps(data, indent=2))


class CodexTokenRefresher:
    """
    Refresh Codex OAuth tokens.

    Uses OpenAI's auth endpoint to refresh access tokens.
    """

    REFRESH_URL = "https://auth.openai.com/oauth/token"
    CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

    async def refresh(self, credentials: CodexCredentials) -> CodexCredentials:
        """
        Refresh the access token.

        Args:
            credentials: Current credentials with refresh_token

        Returns:
            New credentials with refreshed tokens
        """
        if not credentials.refresh_token:
            return credentials

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self.REFRESH_URL,
                headers={"Content-Type": "application/json"},
                json={
                    "client_id": self.CLIENT_ID,
                    "grant_type": "refresh_token",
                    "refresh_token": credentials.refresh_token,
                    "scope": "openid profile email",
                },
            )

            if response.status_code == 401:
                data = response.json()
                error_code = None
                if isinstance(data.get("error"), dict):
                    error_code = data["error"].get("code", "")
                elif isinstance(data.get("error"), str):
                    error_code = data["error"]

                if error_code in (
                    "refresh_token_expired",
                    "refresh_token_reused",
                    "refresh_token_invalidated",
                ):
                    raise AuthenticationError(
                        "Codex refresh token expired. Run 'codex' to re-authenticate."
                    )
                raise AuthenticationError("Codex authentication failed.")

            if response.status_code != 200:
                raise ProviderError(f"Token refresh failed: {response.status_code}")

            data = response.json()

            return CodexCredentials(
                access_token=data.get("access_token", credentials.access_token),
                refresh_token=data.get("refresh_token", credentials.refresh_token),
                id_token=data.get("id_token", credentials.id_token),
                account_id=credentials.account_id,
                last_refresh=datetime.now(timezone.utc),
            )


class CodexProvider(BaseProvider):
    """
    Provider for OpenAI Codex usage metrics.

    Uses the ChatGPT backend API to fetch usage information.
    Credentials are read from ~/.codex/auth.json.

    Environment Variables:
        CODEX_ACCESS_TOKEN: OAuth access token (optional, overrides auth.json)
        CODEX_HOME: Custom Codex home directory (default: ~/.codex)
    """

    name = ProviderName.CODEX

    # API endpoints
    BASE_URL = "https://chatgpt.com/backend-api"
    USAGE_PATH = "/wham/usage"

    def __init__(self, credentials: CodexCredentials | None = None) -> None:
        """
        Initialize the Codex provider.

        Args:
            credentials: OAuth credentials. If not provided, loads from storage.
        """
        self._store = CodexCredentialStore()
        self._refresher = CodexTokenRefresher()
        self._credentials = credentials or self._store.load()

    def is_configured(self) -> bool:
        """Check if Codex credentials are available."""
        return self._credentials is not None and len(self._credentials.access_token) > 0

    def get_config_help(self) -> str:
        """Get configuration instructions."""
        return """OpenAI Codex Provider Configuration:

1. Install Codex CLI and authenticate:
   npm install -g @openai/codex
   codex

2. Credentials will be read from ~/.codex/auth.json

Or set environment variable:
   export CODEX_ACCESS_TOKEN=eyJ...

Note: Token is refreshed automatically when needed."""

    async def fetch(self, window: WindowPeriod = WindowPeriod.DAY_7) -> ProviderResult:
        """
        Fetch OpenAI Codex usage metrics.

        Note: Returns current quota state, not historical data.
        """
        if not self.is_configured():
            return self._make_error_result(
                window=window,
                error="Not configured. Run 'codex' CLI to authenticate.",
            )

        # Refresh token if needed
        if self._credentials and self._credentials.needs_refresh():
            try:
                self._credentials = await self._refresher.refresh(self._credentials)
                self._store.save(self._credentials)
            except AuthenticationError:
                raise
            except Exception:
                pass  # Continue with existing token

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Safe to use _credentials here since is_configured() passed
                assert self._credentials is not None

                headers = {
                    "Authorization": f"Bearer {self._credentials.access_token}",
                    "Accept": "application/json",
                    "User-Agent": "usage-tui",
                }

                # Add account ID if available
                if self._credentials.account_id:
                    headers["ChatGPT-Account-Id"] = self._credentials.account_id

                response = await client.get(
                    f"{self.BASE_URL}{self.USAGE_PATH}",
                    headers=headers,
                )

                if response.status_code in (401, 403):
                    raise AuthenticationError(
                        "Codex token expired. Run 'codex' CLI to re-authenticate."
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
        """
        Parse the Codex usage API response.

        Expected structure:
        {
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 20,
                    "reset_at": 1706435999,
                    "limit_window_seconds": 18000
                },
                "secondary_window": {
                    "used_percent": 10,
                    "reset_at": 1706867999,
                    "limit_window_seconds": 604800
                }
            },
            "credits": {
                "has_credits": true,
                "unlimited": false,
                "balance": 50.0
            }
        }
        """
        rate_limit = data.get("rate_limit", {})

        windows = filter(
            None,
            (rate_limit.get("primary_window"), rate_limit.get("secondary_window")),
        )
        if window == WindowPeriod.HOUR_5:
            window_data = next(
                (item for item in windows if item.get("limit_window_seconds", 0) < 86400),
                {},
            )
        else:
            window_data = next(
                (item for item in windows if item.get("limit_window_seconds", 0) >= 86400),
                {},
            )

        # Parse usage percentage
        used_percent = window_data.get("used_percent")
        remaining = None
        if used_percent is not None:
            remaining = 100.0 - float(used_percent)

        # Parse reset time
        reset_at = None
        if reset_ts := window_data.get("reset_at"):
            try:
                reset_at = datetime.fromtimestamp(reset_ts, tz=timezone.utc)
            except Exception:
                pass

        # Parse credits
        credits = data.get("credits", {})
        cost = None
        if balance := credits.get("balance"):
            try:
                cost = float(balance)
            except (TypeError, ValueError):
                pass

        metrics = UsageMetrics(
            remaining=remaining,
            limit=100.0,  # Percentage-based
            reset_at=reset_at,
            cost=cost,  # Credits balance
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
