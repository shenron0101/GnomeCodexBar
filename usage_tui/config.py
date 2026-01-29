"""Configuration management for usage-tui."""

import os
from pathlib import Path
from typing import Any

from usage_tui.claude_cli_auth import extract_claude_cli_token
from usage_tui.providers.base import ProviderName

# Env file location
ENV_FILE_PATH = Path.home() / ".config" / "usage-tui" / "env"


def load_env_file() -> dict[str, str]:
    """Load key=value pairs from env file. Returns empty dict if missing/unreadable."""
    result: dict[str, str] = {}
    try:
        if ENV_FILE_PATH.exists():
            for line in ENV_FILE_PATH.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    result[key.strip()] = value.strip()
    except (OSError, PermissionError):
        pass
    return result


def write_env_file(updates: dict[str, str]) -> None:
    """Write/update keys in env file. Preserves other lines."""
    ENV_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

    existing_lines: list[str] = []
    existing_keys: set[str] = set()

    try:
        if ENV_FILE_PATH.exists():
            existing_lines = ENV_FILE_PATH.read_text().splitlines()
    except (OSError, PermissionError):
        pass

    new_lines: list[str] = []
    for line in existing_lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, _, _ = stripped.partition("=")
            key = key.strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                existing_keys.add(key)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    # Add new keys not already in file
    for key, value in updates.items():
        if key not in existing_keys:
            new_lines.append(f"{key}={value}")

    ENV_FILE_PATH.write_text("\n".join(new_lines) + "\n")


class Config:
    """
    Application configuration.

    Currently reads only from environment variables.
    Follows the principle of preferring env vars for security.
    """

    # Environment variable mappings
    ENV_VARS = {
        ProviderName.CLAUDE: "CLAUDE_CODE_OAUTH_TOKEN",
        ProviderName.OPENAI: "OPENAI_ADMIN_KEY",
        ProviderName.OPENROUTER: "OPENROUTER_API_KEY",
        ProviderName.COPILOT: "GITHUB_TOKEN",
        ProviderName.CODEX: "CODEX_ACCESS_TOKEN",
    }

    # Provider descriptions
    PROVIDER_INFO = {
        ProviderName.CLAUDE: {
            "name": "Claude Code",
            "description": "Claude Code subscription quota via OAuth",
            "official": False,
            "note": "Uses unofficial OAuth endpoint with beta header",
        },
        ProviderName.OPENAI: {
            "name": "OpenAI",
            "description": "OpenAI API usage and costs",
            "official": True,
            "note": "Requires organization admin API key",
        },
        ProviderName.OPENROUTER: {
            "name": "OpenRouter",
            "description": "OpenRouter API credits and usage",
            "official": True,
            "note": "Uses /api/v1/key for credits and limits",
        },
        ProviderName.COPILOT: {
            "name": "GitHub Copilot",
            "description": "GitHub Copilot quota via internal API",
            "official": False,
            "note": "Uses VS Code client ID for device flow auth",
        },
        ProviderName.CODEX: {
            "name": "OpenAI Codex",
            "description": "OpenAI Codex usage via ChatGPT backend",
            "official": False,
            "note": "Reads credentials from ~/.codex/auth.json",
        },
    }

    def get_token(self, provider: ProviderName) -> str | None:
        """
        Get authentication token for a provider.

        Priority: environment variable > env file > provider-specific credential stores.
        """
        env_var = self.ENV_VARS.get(provider)

        # 1. Check environment variable (highest priority)
        if env_var and (token := os.environ.get(env_var)):
            return token

        # 2. Check env file
        if env_var:
            env_file_values = load_env_file()
            if token := env_file_values.get(env_var):
                return token

        # 3. Provider-specific credential stores
        if provider == ProviderName.CLAUDE:
            return extract_claude_cli_token()

        if provider == ProviderName.CODEX:
            from usage_tui.providers.codex import CodexCredentialStore

            store = CodexCredentialStore()
            creds = store.load()
            return creds.access_token if creds else None

        if provider == ProviderName.COPILOT:
            from usage_tui.providers.copilot import CopilotCredentialStore

            store = CopilotCredentialStore()
            return store.load_token()

        return None

    def is_provider_configured(self, provider: ProviderName) -> bool:
        """
        Check if a provider has required credentials.

        Delegates to provider's is_configured() method for accurate detection.
        """
        # Import providers lazily to avoid circular imports
        from usage_tui.providers import (
            ClaudeOAuthProvider,
            OpenAIUsageProvider,
            OpenRouterUsageProvider,
            CopilotProvider,
            CodexProvider,
        )

        provider_map = {
            ProviderName.CLAUDE: ClaudeOAuthProvider,
            ProviderName.OPENAI: OpenAIUsageProvider,
            ProviderName.OPENROUTER: OpenRouterUsageProvider,
            ProviderName.COPILOT: CopilotProvider,
            ProviderName.CODEX: CodexProvider,
        }

        provider_class = provider_map.get(provider)
        if provider_class:
            return provider_class().is_configured()

        return False

    def get_provider_status(self, provider: ProviderName) -> dict[str, Any]:
        """Get detailed status for a provider."""
        info = self.PROVIDER_INFO.get(provider, {})
        env_var = self.ENV_VARS.get(provider, "UNKNOWN")
        configured = self.is_provider_configured(provider)

        return {
            "provider": provider.value,
            "name": info.get("name", provider.value),
            "description": info.get("description", ""),
            "official": info.get("official", False),
            "note": info.get("note", ""),
            "env_var": env_var,
            "configured": configured,
            "token_preview": self._get_token_preview(provider) if configured else None,
        }

    def get_all_provider_status(self) -> list[dict[str, Any]]:
        """Get status for all providers."""
        return [self.get_provider_status(p) for p in ProviderName]

    def _get_token_preview(self, provider: ProviderName) -> str | None:
        """Get a safe preview of the token (first/last few chars)."""
        token = self.get_token(provider)
        if not token or len(token) < 12:
            return None
        return f"{token[:8]}...{token[-4:]}"

    def get_env_var_help(self) -> str:
        """Get help text for setting up environment variables."""
        lines = ["Required environment variables:\n"]

        for provider in ProviderName:
            env_var = self.ENV_VARS.get(provider)
            info = self.PROVIDER_INFO.get(provider, {})
            configured = self.is_provider_configured(provider)
            status = "[OK]" if configured else "[NOT SET]"

            lines.append(f"  {env_var}  {status}")
            lines.append(f"    {info.get('description', '')}")
            if note := info.get("note"):
                lines.append(f"    Note: {note}")
            lines.append("")

        return "\n".join(lines)


# Global config instance
config = Config()
