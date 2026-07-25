import datetime
import json
import re
from pathlib import Path

import httpx

from usage_tui.providers.base import (
    BaseProvider,
    ProviderName,
    ProviderResult,
    UsageMetrics,
    WindowPeriod,
)

OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
QUOTA_URL = "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels"


class GoogleProvider(BaseProvider):
    name = ProviderName.GOOGLE

    def is_configured(self) -> bool:
        return self._get_refresh_token() is not None

    def get_config_help(self) -> str:
        return "Log in with the Antigravity/OpenCode Google account"

    def _get_account(self) -> dict | None:
        paths = [
            Path.home() / ".config" / "opencode" / "antigravity-accounts.json",
            Path.home() / ".local" / "share" / "opencode" / "antigravity-accounts.json",
        ]
        for p in paths:
            if not p.exists():
                continue
            with open(p) as f:
                data = json.load(f)
            accounts = data.get("accounts", [])
            if accounts:
                return accounts[data.get("activeIndex", 0)]
        return None

    def _get_refresh_token(self) -> str | None:
        account = self._get_account()
        return account.get("refreshToken") if account else None

    @staticmethod
    def _get_oauth_client() -> tuple[str, str]:
        """Read the OAuth client managed by the installed OpenCode plugin."""
        cache = Path.home() / ".cache" / "opencode"
        for path in cache.glob("**/opencode-antigravity-auth/dist/src/constants.js"):
            text = path.read_text()
            client_id = re.search(r'ANTIGRAVITY_CLIENT_ID = "([^"]+)"', text)
            client_secret = re.search(r'ANTIGRAVITY_CLIENT_SECRET = "([^"]+)"', text)
            if client_id and client_secret:
                return client_id.group(1), client_secret.group(1)
        raise ValueError("OpenCode Antigravity auth plugin is not installed")

    @staticmethod
    def _quota_to_raw(quota_data: dict) -> dict:
        """Normalize either a live API response or Antigravity's cached quota."""
        quotas_by_model = {
            entry.get("modelId", ""): entry
            for entry in quota_data.get("quotas", [])
        }
        if not quotas_by_model and quota_data.get("models"):
            quotas_by_model = {
                f"{model_id} {model.get('displayName', '')}".lower(): model.get("quotaInfo", {})
                for model_id, model in quota_data["models"].items()
            }
        if not quotas_by_model:
            quotas_by_model = quota_data

        def get_pct(quota: dict) -> float:
            remaining = quota.get("remainingFraction")
            return round((1.0 - remaining) * 100, 1) if remaining is not None else 0.0

        def quota_for(*names: str) -> dict:
            for name in names:
                if name in quotas_by_model:
                    return quotas_by_model[name]
            for model_id, quota in quotas_by_model.items():
                if any(name in model_id for name in names):
                    return quota
            return {}

        pro_q = quota_for("gemini-pro", "gemini-1.5-pro", "pro")
        flash_q = quota_for("gemini-flash", "gemini-1.5-flash", "flash")
        claude_q = quota_for("claude")
        gpt_oss_q = quota_for("gpt-oss", "gpt_oss")
        raw = {}
        for key, quota in (
            ("gemini_pro", pro_q),
            ("gemini_flash", flash_q),
            ("claude", claude_q),
            ("gpt_oss", gpt_oss_q),
        ):
            raw[key] = {"utilization": get_pct(quota), "reset_time": quota.get("resetTime")}
        return raw

    async def _get_access_token(self, refresh_token: str) -> str:
        client_id, client_secret = self._get_oauth_client()
        async with httpx.AsyncClient() as client:
            resp = await client.post(OAUTH_TOKEN_URL, data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            })
            resp.raise_for_status()
            return resp.json()["access_token"]

    async def fetch(self, window: WindowPeriod = WindowPeriod.HOUR_5) -> ProviderResult:
        metrics = UsageMetrics(remaining=0.0, limit=100.0)
        raw: dict = {}

        try:
            account = self._get_account()
            refresh_token = account.get("refreshToken") if account else None
            if not refresh_token:
                raise ValueError("No Gemini refresh token found in antigravity-accounts.json")

            access_token = await self._get_access_token(refresh_token)
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "User-Agent": "antigravity/1.21.9 linux/amd64",
                "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
                "Client-Metadata": (
                    '{"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}'
                ),
            }

            async with httpx.AsyncClient() as client:
                resp = await client.post(QUOTA_URL, headers=headers, json={})
                resp.raise_for_status()
                quota_data = resp.json()

            raw = self._quota_to_raw(quota_data)

            # Best available reset time for the primary metrics object
            primary_reset_str = raw["gemini_pro"]["reset_time"] or raw["gemini_flash"]["reset_time"]
            reset_dt = None
            if primary_reset_str:
                reset_dt = datetime.datetime.fromisoformat(primary_reset_str.replace("Z", "+00:00"))
                now = datetime.datetime.now(datetime.timezone.utc)
                while reset_dt < now:
                    reset_dt += datetime.timedelta(days=1)

            metrics = UsageMetrics(
                remaining=100.0 - raw["gemini_pro"]["utilization"],
                limit=100.0,
                reset_at=reset_dt,
            )

        except Exception as e:
            return self._make_error_result(window, str(e))

        return ProviderResult(
            provider=self.name,
            window=window,
            metrics=metrics,
            raw=raw,
        )
