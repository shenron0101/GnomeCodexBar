# Version History

## Extension Versions

### v1.0.1 (2026-02-15) - Extension version 3
**Fixed**
- Copilot provider now displays actual credit numbers (e.g., 162/1500) instead of percentages (10.8/100)
- Improved quota tracking accuracy for all Copilot plans (Free, Pro, Business)

**Technical Changes**
- Modified `_extract_quota_data()` to prioritize extracting `entitlement` and `quota_remaining` from API
- Falls back to percentage-based metrics only when actual credits unavailable
- Extension metadata version: 3

### v1.0.0 (Initial Release) - Extension version 2
**Added**
- Initial release of Usage TUI Monitor for GNOME Shell
- Monitor Claude, OpenAI, OpenRouter, Copilot, and Codex usage
- Real-time quota tracking in GNOME top panel
- Color-coded provider indicators
- Auto-refresh with configurable interval
- Extension metadata version: 2

---

## usage-tui Python Package Versions

### v0.1.1 (2026-02-15)
**Fixed**
- Copilot provider now correctly extracts and displays actual credit numbers from API response
- Store actual credit values in `metrics.remaining` and `metrics.limit` instead of percentages

### v0.1.0 (Initial Release)
**Added**
- Multi-provider usage metrics TUI
- Support for Claude, OpenAI, OpenRouter, GitHub Copilot, and Codex
- Interactive TUI with multiple time windows (5h, 7d, 30d)
- JSON output for scripting
- Caching layer to reduce API calls
- OAuth device flow for Copilot authentication

---

## Version Numbering

- **Extension**: Uses semantic versioning for git tags (v1.0.1) but integer versions in metadata.json (3) per GNOME requirements
- **usage-tui**: Uses semantic versioning (0.1.1)
