# GnomeCodexBar Architecture

## Overview

GnomeCodexBar is a GNOME Shell extension that displays AI coding assistant usage limits from the `codexbar` CLI. It shows a combined panel indicator with a popup menu listing all enabled providers.

## Module Structure

```
GnomeCodexBar/
├── metadata.json          # Extension metadata (UUID, shell versions)
├── Makefile               # Build/install workflow
├── schemas/
│   └── ...gschema.xml     # GSettings schema
├── src/
│   ├── extension.js       # Main entry: enable/disable lifecycle
│   ├── indicator.js       # Panel indicator: icon + badge + tooltip
│   ├── menu.js            # Popup menu builder: provider rows
│   ├── cli.js             # CLI wrapper: spawn + parse + cache
│   ├── prefs.js           # Preferences UI (Adw.PreferencesWindow)
│   └── stylesheet.css     # Custom styles
└── docs/
    ├── architecture.md    # This file
    ├── json-schema.md     # CLI JSON field mapping
    └── testing.md         # QA checklist
```

## Module Responsibilities

### extension.js
- **Lifecycle management**: `enable()` / `disable()` hooks
- **Settings initialization**: Load GSettings, connect change signals
- **Refresh timer**: Schedule periodic CLI fetches
- **Cache management**: Load/save cached data to GSettings
- **State machine**: Manage OK → STALE → ERROR transitions
- **UI coordination**: Push state updates to indicator + menu

### indicator.js
- **Panel button**: PanelMenu.Button in top bar
- **Meter icon**: St.DrawingArea with two-bar meter (Cairo drawing)
- **Badge overlay**: Warning/critical count badge
- **Tooltip**: Accessible name with summary
- **State rendering**: Visual state (normal/warning/critical/stale/error)

### menu.js
- **Popup menu**: PopupMenu with sections
- **Provider rows**: Dynamic rows with usage bars and details
- **Empty/error states**: Placeholder UI when no data
- **Footer actions**: Refresh, Open Config, Settings buttons
- **Sorting**: Urgent (lowest first) or alphabetical

### cli.js
- **CLI discovery**: Find `codexbar` in PATH or custom path
- **Subprocess execution**: Gio.Subprocess async with timeout
- **JSON parsing**: Parse CLI output, handle errors
- **Data normalization**: Transform raw JSON to extension format
- **Aggregate stats**: Calculate min percent, warning counts

### prefs.js
- **Adw.PreferencesWindow**: GTK4/libadwaita preferences UI
- **Settings binding**: Bind widgets to GSettings keys
- **Provider visibility**: Toggle checkboxes per provider
- **Advanced options**: CLI path, timeout, debug logging

### stylesheet.css
- **State colors**: Normal, warning (#f6d32d), critical (#f66151)
- **Progress bars**: Filled/empty with transitions
- **Menu styling**: Provider rows, badges, buttons

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Timer / Manual Refresh                                       │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ cli.js: fetchProviders()                                     │
│  • Spawn: codexbar --format json --pretty                    │
│  • Timeout: 10s (configurable)                               │
│  • Parse JSON, normalize provider data                       │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ extension.js: _refresh()                                     │
│  • Update cache (providers, timestamp)                       │
│  • Update state machine (OK / STALE / ERROR)                 │
│  • Save cache to GSettings                                   │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ indicator.js + menu.js: updateState()                        │
│  • Repaint icon with current percentage                      │
│  • Update badge count                                        │
│  • Rebuild menu rows if open                                 │
└─────────────────────────────────────────────────────────────┘
```

## State Machine

```
States:
  IDLE          Initial state, no request active
  LOADING       Refresh in progress
  OK            Fresh successful data
  STALE         Data older than stale threshold
  ERROR         Fetch failed, no cached data
  ERROR_WITH_CACHE  Fetch failed, cached data available

Transitions:
  IDLE → LOADING           on refresh trigger
  LOADING → OK             on CLI success
  LOADING → ERROR          on CLI failure (no cache)
  LOADING → ERROR_WITH_CACHE  on CLI failure (has cache)
  OK → STALE               when age > stale_after_seconds
  STALE → OK               on CLI success
  ERROR* → OK              on CLI success
  ERROR_WITH_CACHE → STALE when cache age exceeds threshold
```

## GSettings Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| refresh-interval | int | 300 | Seconds between refreshes |
| refresh-on-open | bool | false | Refresh when menu opens |
| stale-after-seconds | int | 600 | Data TTL before stale |
| show-text | bool | false | Show % text in panel |
| show-badge | bool | true | Show warning badge |
| reset-display-mode | string | countdown | countdown or absolute |
| sort-mode | string | urgent | urgent or alphabetical |
| warning-threshold | int | 20 | Warning % threshold |
| critical-threshold | int | 5 | Critical % threshold |
| provider-visibility | string | {} | JSON map of visibility |
| cli-path | string | "" | Custom CLI path |
| cli-timeout | int | 10 | CLI timeout seconds |
| debug-logging | bool | false | Enable debug logs |
| cache-last-payload | string | "" | Cached JSON (internal) |
| cache-last-success-ts | int64 | 0 | Last success time |
| cache-last-error | string | "" | Last error message |

## GNOME Shell Compatibility

- **Target versions**: GNOME Shell 46, 47, 48, 49
- **API notes**:
  - Uses St.DrawingArea instead of Clutter.Canvas (GNOME 46+)
  - Uses `cr.setSourceRGBA()` instead of deprecated helpers
  - Preferences use Adw.PreferencesWindow (deprecated but functional)
  - PopupMenu uses `:selected` pseudo-class (GNOME 47+)
