# Usage TUI

Multi-provider usage metrics TUI for Claude, OpenAI, and GitHub Copilot.

## Features

- View usage/quota/cost metrics across multiple AI providers
- Interactive TUI with Textual
- CLI commands for scripting and automation
- Caching to reduce API calls
- Provider-agnostic normalized output format

## Supported Providers

| Provider | Status | Auth Required |
|----------|--------|---------------|
| Claude Code | OAuth (unofficial) | `CLAUDE_CODE_OAUTH_TOKEN` or Claude CLI |
| OpenAI | Official API | `OPENAI_ADMIN_KEY` |
| OpenAI Codex | OAuth (unofficial) | `~/.codex/auth.json` or `CODEX_ACCESS_TOKEN` |
| GitHub Copilot | Device flow (internal API) | `usage-tui login --provider copilot` or `GITHUB_TOKEN` |

## Installation

```bash
# From source
pip install -e .

# Or with pipx
pipx install .
```

## Configuration

### Claude Code (OAuth)

```bash
# Install and authenticate Claude CLI
npm install -g @anthropics/claude
claude setup-token

# Optional: extract token (uses CLI credentials automatically)
usage-tui login --provider claude

# Or set explicitly
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

Notes:
- Requires an OAuth token with the `user:profile` scope
- Uses an unofficial endpoint and may change

### OpenAI (Admin API)

```bash
export OPENAI_ADMIN_KEY=sk-...
```

### OpenAI Codex (ChatGPT backend)

```bash
# Install and authenticate Codex CLI
npm install -g @openai/codex
codex

# Or set explicitly
export CODEX_ACCESS_TOKEN=eyJ...
```

### GitHub Copilot

```bash
# Device flow login (recommended)
usage-tui login --provider copilot

# Or set a token
export GITHUB_TOKEN=ghp_...
```

## Usage

### Interactive TUI

```bash
usage-tui tui
```

**Keyboard shortcuts:**
- `r` - Refresh data
- `1` - Switch to 1 day window
- `7` - Switch to 7 day window  
- `3` - Switch to 30 day window
- `j` - Toggle raw JSON view
- `q` - Quit

### CLI Commands

```bash
# Show all providers
usage-tui show

# Show specific provider
usage-tui show --provider claude
usage-tui show --provider openai

# Change time window
usage-tui show --window 1d
usage-tui show --window 30d

# Output as JSON (for scripting)
usage-tui show --json

# Check configuration
usage-tui doctor

# Show required env vars
usage-tui env
```

Notes:
- Default `usage-tui show` prints both 5-hour and 7-day windows for Claude and Codex
- Use `--window` to force a single window output

## Project Structure

```
usage_tui/
  __init__.py
  cli.py           # CLI entry point
  tui.py           # Textual TUI application
  cache.py         # Caching layer
  config.py        # Configuration management
  providers/
    __init__.py
    base.py        # Base provider interface
    claude_oauth.py    # Claude Code OAuth provider
    openai_usage.py    # OpenAI usage provider
    codex.py           # OpenAI Codex usage provider
    copilot.py         # GitHub Copilot usage provider
```

## Normalized Output Format

All providers return data in this normalized format:

```json
{
  "provider": "claude | openai | copilot",
  "window": "1d | 7d | 30d",
  "metrics": {
    "cost": 1.42,
    "requests": 37,
    "input_tokens": 120000,
    "output_tokens": 54000,
    "remaining": null,
    "limit": null,
    "reset_at": "ISO8601 | null"
  },
  "updated_at": "ISO8601",
  "raw": {}
}
```

## Known Limitations

| Provider | Limitation |
|----------|-----------|
| Claude | OAuth usage endpoint is unofficial and may change |
| Copilot | Internal API, may lag or change |
| OpenAI | Requires organization admin API key |
| Codex | Uses ChatGPT backend OAuth, may change |

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run linting
ruff check .

# Run type checking
mypy usage_tui

# Run tests
pytest
```

## Future Extensions

- GNOME extension (poll localhost daemon)
- Waybar / i3blocks output mode
- Prometheus exporter
- Unified daily usage ledger

## License

MIT
