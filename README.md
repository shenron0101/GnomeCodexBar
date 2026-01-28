# GNOME CodexBar

A GNOME Shell extension that displays AI coding assistant usage limits in your top bar. Track usage for Claude, GitHub Copilot, Cursor, Gemini, and more.

## Features

- Combined panel indicator with meter-style icon
- Dropdown menu showing all providers with usage details
- Session/weekly usage windows with reset countdowns
- Credit balances and percentages
- Color-coded warnings (normal/warning/critical states)
- Configurable refresh intervals
- Cache support for offline viewing

## Requirements

- GNOME Shell 46, 47, 48, or 49
- [CodexBar CLI](https://github.com/codexbar/codexbar) installed and in PATH

## Installation

### From Source

```bash
git clone https://github.com/codexbar/gnome-codexbar.git
cd gnome-codexbar
make install-local
```

### From Zip

```bash
gnome-extensions install gnome-codexbar@codexbar.app.zip
```

After installation, restart GNOME Shell:
- **X11**: Press `Alt+F2`, type `r`, press Enter
- **Wayland**: Log out and log back in

Then enable the extension:

```bash
gnome-extensions enable gnome-codexbar@codexbar.app
```

## Configuration

Open the extension preferences:

```bash
gnome-extensions prefs gnome-codexbar@codexbar.app
```

Or use GNOME Extensions app.

### Available Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Refresh Interval | Seconds between updates | 300 |
| Show Text | Display percentage next to icon | false |
| Show Badge | Display warning count badge | true |
| Warning Threshold | Percent remaining for warning state | 20 |
| Critical Threshold | Percent remaining for critical state | 5 |
| CLI Path | Path to codexbar executable | codexbar |
| CLI Timeout | Timeout in seconds for CLI calls | 30 |
| Refresh on Open | Refresh data when menu opens | true |
| Debug Logging | Enable verbose logging | false |

## Development

### Prerequisites

```bash
npm install    # Install test dependencies
```

### Build Commands

```bash
make help              # Show all available targets
make extension         # Build (compile schemas)
make install-local     # Install to user extensions directory
make uninstall         # Remove installed extension
make zip-file          # Create distributable zip
make logs              # Follow GNOME Shell logs
make prefs             # Open preferences
```

### Unit Tests

The extension uses Vitest for testing pure logic functions:

```bash
make test              # Run tests once
make test-watch        # Run tests in watch mode
npm run test:coverage  # Run with coverage
```

Tests are located in `tests/` and cover provider normalization, stats calculation, and formatting utilities.

### Dev Loop (Wayland-friendly)

Use a nested GNOME Shell session for quick iteration without logging out:

```bash
make dev-loop
```

This will:
1. Run unit tests (fails fast if tests break)
2. Build the extension zip
3. Install to user extensions directory
4. Launch a nested Wayland session
5. Auto-enable the extension
6. Tail filtered logs (errors, warnings, extension messages)
7. Show extension state and error summary on exit

Optional flags (run the script directly):

```bash
./scripts/dev-loop.sh --no-tail        # Don't tail logs
./scripts/dev-loop.sh --no-filter      # Show all logs (not just errors)
./scripts/dev-loop.sh --verbose        # Enable G_MESSAGES_DEBUG=all
./scripts/dev-loop.sh --no-build       # Skip build step
./scripts/dev-loop.sh -h               # Show all options
```

Tips for the nested session:
- **Alt+F2 -> 'lg'**: Opens Looking Glass (JS debugger/console)
- Check the top bar for the CodexBar indicator
- **Ctrl+C** in terminal exits the nested session

### Project Structure

```
GnomeCodexBar/
├── metadata.json           # Extension metadata
├── Makefile               # Build workflow
├── schemas/               # GSettings schema
├── src/
│   ├── extension.js       # Main lifecycle & timer
│   ├── indicator.js       # Panel button with icon
│   ├── menu.js            # Popup menu with providers
│   ├── cli.js             # Async CLI wrapper
│   ├── prefs.js           # Preferences window
│   └── stylesheet.css     # Styles
└── docs/
    ├── architecture.md    # Module design
    ├── json-schema.md     # CLI JSON format
    └── testing.md         # QA checklist
```

### Debugging

View extension logs:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -iE "codexbar"
```

Enable debug mode in preferences for verbose output.

## CLI JSON Format

The extension invokes `codexbar --format json` and expects an array of provider objects:

```json
[
  {
    "provider": "claude",
    "version": "1.0.0",
    "source": "cli",
    "status": "ok",
    "usage": {
      "primary": {
        "usedPercent": 45.5,
        "windowMinutes": 180,
        "resetsAt": "2024-01-28T12:00:00Z",
        "resetDescription": "Resets in 2h 30m"
      }
    },
    "credits": {
      "current": 50.25,
      "max": 100.0,
      "percentage": 50.25
    }
  }
]
```

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test with `make install-local`
4. Submit a pull request

## Credits

- Inspired by [CodexBar](https://github.com/codexbar/codexbar) for macOS
- Uses patterns from [Dash to Panel](https://github.com/home-sweet-gnome/dash-to-panel)
