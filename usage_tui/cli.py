"""CLI entry point for usage-tui."""

import asyncio
import json
import sys

import click
from click.core import ParameterSource

from usage_tui.config import config
from usage_tui.providers import (
    ClaudeOAuthProvider,
    OpenAIUsageProvider,
    OpenRouterUsageProvider,
    CopilotProvider,
    CodexProvider,
)
from usage_tui.providers.base import BaseProvider, ProviderError, ProviderName, WindowPeriod


def get_providers() -> dict[ProviderName, BaseProvider]:
    """Get all available providers."""
    return {
        ProviderName.CLAUDE: ClaudeOAuthProvider(),
        ProviderName.OPENAI: OpenAIUsageProvider(),
        ProviderName.OPENROUTER: OpenRouterUsageProvider(),
        ProviderName.COPILOT: CopilotProvider(),
        ProviderName.CODEX: CodexProvider(),
    }


def parse_window(window: str) -> WindowPeriod:
    """Parse window string to WindowPeriod enum."""
    mapping = {
        "5h": WindowPeriod.HOUR_5,
        "7d": WindowPeriod.DAY_7,
        "30d": WindowPeriod.DAY_30,
    }
    if window not in mapping:
        raise click.BadParameter(f"Invalid window. Choose from: {', '.join(mapping.keys())}")
    return mapping[window]


def parse_provider(provider: str) -> ProviderName | None:
    """Parse provider string. Returns None for 'all'."""
    if provider == "all":
        return None
    try:
        return ProviderName(provider)
    except ValueError:
        valid = ", ".join([p.value for p in ProviderName] + ["all"])
        raise click.BadParameter(f"Invalid provider. Choose from: {valid}")


def _fetch_result(provider: BaseProvider, window: WindowPeriod):
    """Fetch provider metrics, converting errors into results."""
    try:
        return asyncio.run(provider.fetch(window))
    except ProviderError as exc:
        return provider._make_error_result(window=window, error=str(exc))
    except Exception as exc:
        return provider._make_error_result(window=window, error=f"Unexpected error: {exc}")


@click.group()
@click.version_option()
def main() -> None:
    """Usage metrics TUI for Claude, OpenAI, OpenRouter, Copilot, and Codex."""
    pass


@main.command()
@click.option(
    "--provider",
    "-p",
    default="all",
    help="Provider to query (claude, openai, openrouter, copilot, codex, all)",
)
@click.option(
    "--window",
    "-w",
    default="7d",
    help="Time window (5h, 7d, 30d)",
)
@click.option(
    "--json",
    "output_json",
    is_flag=True,
    help="Output raw JSON instead of formatted text",
)
def show(provider: str, window: str, output_json: bool) -> None:
    """Show usage metrics for providers."""
    window_period = parse_window(window)
    provider_filter = parse_provider(provider)

    ctx = click.get_current_context()
    window_source = ctx.get_parameter_source("window")

    providers = get_providers()

    # Filter to specific provider if requested
    if provider_filter:
        if provider_filter not in providers:
            click.echo(f"Provider {provider_filter.value} not implemented yet.", err=True)
            sys.exit(1)
        providers = {provider_filter: providers[provider_filter]}

    results = {}
    for name, prov in providers.items():
        if not prov.is_configured():
            if not output_json:
                click.echo(f"\n{name.value}: Not configured")
                click.echo(f"  Set {config.ENV_VARS.get(name)} environment variable")
            continue

        # Show both 5h and 7d windows for quota-based providers when using default window
        show_dual_windows = (
            not output_json
            and window_source == ParameterSource.DEFAULT
            and name in {ProviderName.CLAUDE, ProviderName.CODEX}
        )

        if show_dual_windows:
            result_5h = _fetch_result(prov, WindowPeriod.HOUR_5)
            result_7d = _fetch_result(prov, WindowPeriod.DAY_7)
            results[name.value] = result_7d
            _print_result(name, result_5h, label="5h")
            _print_result(name, result_7d, label="7d")
        else:
            result = _fetch_result(prov, window_period)
            results[name.value] = result
            if not output_json:
                _print_result(name, result)

    if output_json:
        output = {k: v.model_dump(mode="json") for k, v in results.items()}
        click.echo(json.dumps(output, indent=2))


def _print_result(name: ProviderName, result, label: str | None = None) -> None:
    """Print a formatted result."""
    title = name.value.upper()
    if label:
        title = f"{title} ({label})"
    click.echo(f"\n{click.style(title, bold=True)}")
    click.echo("-" * 40)

    if result.is_error:
        click.echo(click.style(f"Error: {result.error}", fg="red"))
        return

    m = result.metrics

    # Usage percentage (Claude)
    if m.usage_percent is not None:
        pct = m.usage_percent
        color = "green" if pct < 50 else ("yellow" if pct < 80 else "red")
        bar = _progress_bar(pct)
        click.echo(f"Usage:    {bar} {click.style(f'{pct:.1f}%', fg=color)}")

    # Reset time
    if m.reset_at:
        from datetime import datetime, timezone

        delta = m.reset_at - datetime.now(timezone.utc)
        if delta.total_seconds() > 0:
            hours = int(delta.total_seconds() // 3600)
            mins = int((delta.total_seconds() % 3600) // 60)
            click.echo(f"Resets:   {hours}h {mins}m")

    # Cost
    if m.cost is not None:
        click.echo(f"Cost:     ${m.cost:.4f}")

    # Requests
    if m.requests is not None:
        click.echo(f"Requests: {m.requests:,}")

    # Tokens
    if m.input_tokens is not None or m.output_tokens is not None:
        total = (m.input_tokens or 0) + (m.output_tokens or 0)
        click.echo(
            f"Tokens:   {total:,} ({m.input_tokens or 0:,} in / {m.output_tokens or 0:,} out)"
        )


def _progress_bar(percent: float, width: int = 20) -> str:
    """Create a text progress bar."""
    filled = int(width * percent / 100)
    empty = width - filled
    return f"[{'#' * filled}{'-' * empty}]"


@main.command()
def doctor() -> None:
    """Check provider configuration and connectivity."""
    click.echo("Usage TUI Doctor")
    click.echo("=" * 40)
    click.echo()

    providers = get_providers()
    all_ok = True

    for name, provider in providers.items():
        info = config.get_provider_status(name)

        click.echo(f"{click.style(info['name'], bold=True)}")

        # Check configuration
        if info["configured"]:
            click.echo(f"  Config:     {click.style('OK', fg='green')} ({info['token_preview']})")
        else:
            click.echo(f"  Config:     {click.style('MISSING', fg='red')}")
            click.echo(f"              Set: {info['env_var']}")
            all_ok = False
            click.echo()
            continue

        # Test connectivity
        click.echo("  Testing:    ", nl=False)
        result = _fetch_result(provider, WindowPeriod.HOUR_5)
        if result.is_error:
            click.echo(click.style(f"FAILED - {result.error}", fg="red"))
            all_ok = False
        else:
            click.echo(click.style("OK", fg="green"))

        # Show notes
        if info.get("note"):
            click.echo(f"  Note:       {info['note']}")

        click.echo()

    # Summary
    click.echo("-" * 40)
    if all_ok:
        click.echo(click.style("All providers healthy!", fg="green"))
    else:
        click.echo(click.style("Some providers need attention.", fg="yellow"))


@main.command()
def tui() -> None:
    """Launch the interactive TUI."""
    from usage_tui.tui import run_tui

    run_tui()


@main.command()
def env() -> None:
    """Show required environment variables."""
    click.echo(config.get_env_var_help())


@main.command()
def setup() -> None:
    """Interactive setup wizard for API keys."""
    from usage_tui.config import ENV_FILE_PATH, write_env_file

    click.echo()
    click.echo("Usage TUI Setup")
    click.echo("=" * 40)
    click.echo()
    click.echo(f"Keys will be saved to: {ENV_FILE_PATH}")
    click.echo("Press Enter to skip any key.")
    click.echo()

    updates: dict[str, str] = {}

    # OpenRouter API key
    click.echo(click.style("OpenRouter", bold=True))
    click.echo("  Get your API key from: https://openrouter.ai/keys")
    openrouter_key = click.prompt("  OPENROUTER_API_KEY", default="", show_default=False).strip()
    if openrouter_key:
        updates["OPENROUTER_API_KEY"] = openrouter_key
        click.echo("  -> Set")
    else:
        click.echo("  -> Skipped")
    click.echo()

    # OpenAI Admin key
    click.echo(click.style("OpenAI", bold=True))
    click.echo("  Requires organization admin API key.")
    click.echo("  Get it from: https://platform.openai.com/settings/organization/admin-keys")
    openai_key = click.prompt("  OPENAI_ADMIN_KEY", default="", show_default=False).strip()
    if openai_key:
        updates["OPENAI_ADMIN_KEY"] = openai_key
        click.echo("  -> Set")
    else:
        click.echo("  -> Skipped")
    click.echo()

    # GitHub token (optional)
    click.echo(click.style("GitHub Copilot", bold=True))
    click.echo("  Optional: provide a GitHub token, or use device flow login later.")
    click.echo("  Recommended: run 'usage-tui login --provider copilot' instead.")
    github_token = click.prompt("  GITHUB_TOKEN", default="", show_default=False).strip()
    if github_token:
        updates["GITHUB_TOKEN"] = github_token
        click.echo("  -> Set")
    else:
        click.echo("  -> Skipped")
    click.echo()

    # Claude - print instructions only
    click.echo(click.style("Claude Code", bold=True))
    click.echo("  Uses Claude CLI credentials automatically.")
    click.echo("  To set up:")
    click.echo("    npm install -g @anthropics/claude")
    click.echo("    claude setup-token")
    click.echo()

    # Codex - print instructions only
    click.echo(click.style("OpenAI Codex", bold=True))
    click.echo("  Uses Codex CLI credentials automatically.")
    click.echo("  To set up:")
    click.echo("    npm install -g @openai/codex")
    click.echo("    codex")
    click.echo()

    # Write to env file
    if updates:
        write_env_file(updates)
        click.echo("-" * 40)
        click.echo(click.style("Configuration saved!", fg="green"))
        click.echo(f"File: {ENV_FILE_PATH}")
        click.echo()
        click.echo("Keys saved:")
        for key in updates:
            click.echo(f"  {key}: set")
    else:
        click.echo("-" * 40)
        click.echo("No keys provided. Nothing saved.")

    click.echo()
    click.echo("Next steps:")
    click.echo("  usage-tui show --json")
    click.echo("  usage-tui show")
    click.echo("  usage-tui doctor")
    click.echo("  usage-tui tui")


@main.command()
@click.option(
    "--provider",
    "-p",
    default="claude",
    help="Provider to login to (claude, copilot)",
)
def login(provider: str) -> None:
    """
    Authenticate with a provider.

    For Claude: Extracts token from existing Claude CLI installation.
    For Copilot: Performs GitHub device flow authentication.
    """
    if provider == "claude":
        _login_claude()
    elif provider == "copilot":
        _login_copilot()
    else:
        click.echo(f"Login not supported for provider: {provider}")
        click.echo("Supported providers: claude, copilot")
        sys.exit(1)


def _login_claude() -> None:
    """Login for Claude provider."""
    from usage_tui.claude_cli_auth import ClaudeCLIAuth

    auth = ClaudeCLIAuth()

    if not auth.is_available():
        click.echo(click.style("\n Claude CLI credentials not found", fg="red"))
        click.echo()
        click.echo("To set up Claude CLI:")
        click.echo("  1. Install: npm install -g @anthropics/claude")
        click.echo("  2. Authenticate: claude setup-token")
        click.echo("  3. Then run 'usage-tui login' again")
        sys.exit(1)

    info = auth.get_token_info()

    if info["expired"]:
        click.echo(click.style("\n Token expired", fg="yellow"))
        click.echo()
        click.echo("Run this to refresh:")
        click.echo("  claude setup-token")
        sys.exit(1)

    token = auth.get_access_token()

    if token:
        click.echo()
        click.echo("=" * 60)
        click.echo(click.style(" Token extracted successfully!", fg="green", bold=True))
        click.echo()
        click.echo(f"  Token:      {token[:15]}...")
        if expires_in := info.get("expires_in_hours"):
            click.echo(f"  Expires in: {expires_in} hours")
        if scopes := info.get("scopes"):
            click.echo(f"  Scopes:     {', '.join(scopes)}")
        click.echo()
        click.echo("Token auto-loaded from ~/.claude/.credentials.json")
        click.echo("You can now run: usage-tui show --provider claude")
        click.echo("=" * 60)
    else:
        click.echo(click.style("\n Could not extract token", fg="red"))
        sys.exit(1)


def _login_copilot() -> None:
    """Login for GitHub Copilot provider via device flow."""
    from usage_tui.providers.copilot import CopilotProvider

    click.echo()
    click.echo("GitHub Copilot Login")
    click.echo("=" * 40)
    click.echo()

    provider = CopilotProvider()

    try:
        token = asyncio.run(provider.login())
        click.echo()
        click.echo(click.style(" Login successful!", fg="green", bold=True))
        click.echo()
        click.echo(f"  Token saved to: ~/.config/usage-tui/copilot.json")
        click.echo()
        click.echo("You can now run: usage-tui show --provider copilot")
    except Exception as e:
        click.echo(click.style(f"\n Login failed: {e}", fg="red"))
        sys.exit(1)


if __name__ == "__main__":
    main()
