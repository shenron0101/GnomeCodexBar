# CodexBar CLI JSON Schema

## Overview

The `codexbar` CLI outputs an array of provider payloads when run with `--format json`. This document maps the JSON fields to the GNOME extension UI.

## CLI Invocation

```bash
codexbar --format json --pretty
```

**Exit Codes**:
- 0: Success
- 1: General error
- 2: CLI/binary not found

## Top-Level Structure

The CLI returns an array of provider objects:

```json
[
  {
    "provider": "codex",
    "version": "0.6.0",
    "source": "cli",
    "account": "user@example.com",
    "status": { ... },
    "usage": { ... },
    "credits": { ... },
    "error": null
  },
  ...
]
```

## Provider Payload Fields

| Field | Type | Description | UI Mapping |
|-------|------|-------------|------------|
| provider | string | Provider ID (codex, claude, etc.) | Provider name header |
| version | string? | Provider/tool version | Shown next to name |
| source | string | Data source (cli, api, oauth, local) | Info display |
| account | string? | Account email | Account line in details |
| status | object? | Service status info | Status indicator |
| usage | object? | Usage windows | Progress bars + reset times |
| credits | object? | Credits remaining | Credits line |
| error | object? | Error info if fetch failed | Error message |

## Status Object

```json
{
  "indicator": "operational",
  "description": "All systems operational",
  "updatedAt": "2026-01-28T12:00:00Z",
  "url": "https://status.example.com"
}
```

| Field | Type | Description | UI Mapping |
|-------|------|-------------|------------|
| indicator | string | operational, degraded, outage | Status icon (✓/⚠) |
| description | string? | Human-readable status | Status text |
| updatedAt | string? | ISO 8601 timestamp | Not shown |
| url | string? | Status page URL | Not shown |

## Usage Object

```json
{
  "primary": { ... },
  "secondary": { ... },
  "tertiary": { ... },
  "identity": { ... }
}
```

### Usage Window (primary/secondary/tertiary)

```json
{
  "usedPercent": 28.5,
  "windowMinutes": 300,
  "resetsAt": "2026-01-28T17:00:00Z",
  "resetDescription": "3h 45m remaining"
}
```

| Field | Type | Description | UI Mapping |
|-------|------|-------------|------------|
| usedPercent | number | % of quota used (0-100) | Progress bar (100 - used) |
| windowMinutes | number? | Window duration in minutes | Not shown directly |
| resetsAt | string? | ISO 8601 reset time | Reset countdown |
| resetDescription | string? | Human-readable reset | Alternative to countdown |

### Identity Object

```json
{
  "accountEmail": "user@example.com",
  "accountOrganization": "Acme Corp",
  "loginMethod": "Pro Plan"
}
```

| Field | Type | Description | UI Mapping |
|-------|------|-------------|------------|
| accountEmail | string? | User email | Account line |
| accountOrganization | string? | Organization name | Org line |
| loginMethod | string? | Plan/tier name | Plan line |

## Credits Object

```json
{
  "remaining": 112.4,
  "updatedAt": "2026-01-28T12:00:00Z"
}
```

| Field | Type | Description | UI Mapping |
|-------|------|-------------|------------|
| remaining | number | Credits remaining | Credits line |
| updatedAt | string? | Last updated time | Not shown |

## Error Object

```json
{
  "kind": "network",
  "code": "ECONNREFUSED",
  "message": "Connection refused"
}
```

| Field | Type | Description | UI Mapping |
|-------|------|-------------|------------|
| kind | string | Error category | Not shown |
| code | string | Error code | Not shown |
| message | string | Human-readable error | Error message |

## Provider-Specific Notes

### Codex
- primary = Session (5h window)
- secondary = Weekly
- credits = API credits remaining

### Claude Code
- primary = Session
- secondary = Weekly (may be null)
- tertiary = Sonnet tier (if applicable)

### Gemini
- primary = Pro tier (24h)
- secondary = Flash tier (24h)
- Plan in loginMethod

### Kimi
- primary = Weekly quota
- secondary = 5-hour rate limit

### Kimi K2
- primary = Credits-based (no reset time)

### Kiro
- primary = Monthly credits
- secondary = Bonus credits (expiry)

### z.ai / Factory
- primary = Token limit
- secondary = Time limit (if both present)

## Linux Compatibility

**Supported sources on Linux**: `cli`, `api`, `oauth`, `local`

**NOT supported on Linux**: `web`, `auto` (require browser cookies)

Providers relying on web/cookie sources are effectively macOS-only unless they also support cli/api/oauth.

## Edge Cases

1. **Missing secondary/tertiary**: Windows may be `null`; hide those rows
2. **Missing identity**: Account/plan fields optional
3. **CLI errors**: `provider: "cli"` entries contain error info
4. **Invalid JSON**: Preserve last cached data, show stale/error state
5. **Partial data**: Some providers may only have credits, no windows
