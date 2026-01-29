# Complete Guide: Building a usage-tui GNOME Extension

This guide walks you through creating a GNOME Shell extension that displays usage metrics from `usage-tui` in the top panel with a popup UI. It covers everything from understanding our existing codebase to debugging and installation.

---

## Table of Contents

1. [Understanding Our Codebase](#1-understanding-our-codebase)
2. [GNOME Extension Architecture](#2-gnome-extension-architecture)
3. [Development Environment Setup](#3-development-environment-setup)
4. [Extension File Structure](#4-extension-file-structure)
5. [Complete Extension Code](#5-complete-extension-code)
6. [Parsing usage-tui Output](#6-parsing-usage-tui-output)
7. [Installation](#7-installation)
8. [Development Workflow on Wayland](#8-development-workflow-on-wayland)
9. [Debugging](#9-debugging)
10. [Advanced Features](#10-advanced-features)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Understanding Our Codebase

### 1.1 Project Overview

This is a Python CLI/TUI tool for monitoring AI service usage across multiple providers:

| Provider | Description | Configuration |
|----------|-------------|---------------|
| **claude** | Anthropic Claude API | Via `claude setup-token` or env var |
| **openai** | OpenAI API | `OPENAI_API_KEY` environment variable |
| **openrouter** | OpenRouter API | `OPENROUTER_API_KEY` environment variable |
| **copilot** | GitHub Copilot | OAuth via `usage-tui login --provider copilot` |
| **codex** | OpenAI Codex CLI | Uses Codex CLI configuration |

### 1.2 Key Output Formats

**Text Output (`usage-tui show`):**
```
CLAUDE
----------------------------------------
Usage:    [##########----------] 45.0%
Resets:   3h 45m
Cost:     $12.3456
Requests: 1,234
Tokens:   45,678 (12,345 in / 33,333 out)

OPENAI
----------------------------------------
Cost:     $23.4567
Requests: 2,345
Tokens:   89,012 (34,567 in / 54,445 out)
```

**JSON Output (`usage-tui show --json`):**
```json
{
  "claude": {
    "provider": "claude",
    "window": "7d",
    "metrics": {
      "cost": 12.3456,
      "requests": 1234,
      "input_tokens": 12345,
      "output_tokens": 33333,
      "remaining": 450.0,
      "limit": 1000.0,
      "reset_at": "2025-01-30T00:00:00+00:00"
    },
    "updated_at": "2025-01-29T12:00:00.000000",
    "raw": {},
    "error": null
  },
  "openai": {
    "provider": "openai",
    "window": "7d",
    "metrics": {
      "cost": 23.4567,
      "requests": 2345,
      "input_tokens": 34567,
      "output_tokens": 54445
    },
    "updated_at": "2025-01-29T12:00:00.000000",
    "raw": {},
    "error": null
  }
}
```

### 1.3 Window Periods

- `5h` - 5-hour window (for Claude/Codex quota tracking)
- `7d` - 7-day window (default)
- `30d` - 30-day window

---

## 2. GNOME Extension Architecture

GNOME Shell extensions are written in JavaScript (GJS) and interact with the GNOME Shell runtime.

| Concept | Description |
|---------|-------------|
| **GJS** | GNOME's JavaScript runtime, based on Mozilla's SpiderMonkey engine |
| **GObject Introspection** | Allows JS to call C libraries (GTK, St, Clutter, etc.) |
| **St (Shell Toolkit)** | Widget library for GNOME Shell UI elements |
| **Clutter** | The underlying graphics/animation library |
| **Main** | Core GNOME Shell module for accessing panel, overview, etc. |
| **PanelMenu** | Module for creating panel buttons with dropdown menus |

Extension lifecycle:
- `enable()` — Called when the extension is activated
- `disable()` — Called when the extension is deactivated (must clean up everything)
- `constructor()` — Called once when the extension class is instantiated

---

## 3. Development Environment Setup

### 3.1 Prerequisites

```bash
# Check your GNOME Shell version
gnome-shell --version

# Install development tools (Fedora)
sudo dnf install gnome-shell gnome-extensions-app gnome-tweaks gjs

# Install development tools (Ubuntu/Debian)
sudo apt install gnome-shell gnome-shell-extensions gnome-tweaks gjs

# Install development tools (Arch)
sudo pacman -S gnome-shell gnome-extensions gnome-tweaks gjs
```

### 3.2 Verify usage-tui Installation

```bash
# Ensure usage-tui is installed
usage-tui show

# Test JSON output
usage-tui show --json

# Test with specific provider
usage-tui show --provider claude
usage-tui show --provider openai --window 30d
```

### 3.3 Create the Extension Directory

```bash
# Create extension directory
mkdir -p ~/.local/share/gnome-shell/extensions/usage-tui@gnome.codexbar

# Navigate to it
cd ~/.local/share/gnome-shell/extensions/usage-tui@gnome.codexbar
```

### 3.4 Set Up a Development Symlink (Recommended)

```bash
# Create a development directory in our repo
mkdir -p /home/omegashenr01n/Desktop/Projects/GnomeCodexBar/extension

# Remove the original and create symlink
rm -rf ~/.local/share/gnome-shell/extensions/usage-tui@gnome.codexbar
ln -s /home/omegashenr01n/Desktop/Projects/GnomeCodexBar/extension \
    ~/.local/share/gnome-shell/extensions/usage-tui@gnome.codexbar
```

---

## 4. Extension File Structure

```
extension/
├── metadata.json       # Required: Extension metadata
├── extension.js        # Required: Main extension code
├── stylesheet.css      # Optional: Custom CSS styling
└── icons/              # Optional: Provider icons
    ├── claude-symbolic.svg
    ├── openai-symbolic.svg
    ├── openrouter-symbolic.svg
    ├── copilot-symbolic.svg
    └── codex-symbolic.svg
```

---

## 5. Complete Extension Code

### 5.1 metadata.json

```json
{
  "uuid": "usage-tui@gnome.codexbar",
  "name": "usage-tui Monitor",
  "description": "Display AI service usage metrics (Claude, OpenAI, OpenRouter, Copilot, Codex) in the top panel",
  "version": 1,
  "shell-version": ["45", "46", "47", "48"],
  "url": "https://github.com/shobhitpachauri/usage-tui",
  "settings-schema": "org.gnome.shell.extensions.usage-tui",
  "gettext-domain": "usage-tui"
}
```

### 5.2 extension.js

```javascript
/**
 * usage-tui GNOME Extension
 * 
 * Displays AI service usage metrics from usage-tui in the GNOME Shell top panel
 * with a dropdown popup showing detailed statistics for all providers.
 * 
 * @author Based on usage-tui project
 * @version 1.0
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Configuration
const REFRESH_INTERVAL_SECONDS = 300; // 5 minutes
const COMMAND = 'usage-tui show --json';

// Provider colors for UI
const PROVIDER_COLORS = {
    'claude': '#D4A574',     // Anthropic beige/orange
    'openai': '#74AA9C',     // OpenAI green
    'openrouter': '#FF6B35', // OpenRouter orange
    'copilot': '#6E40C9',    // GitHub purple
    'codex': '#FF6B35'       // Same as OpenRouter
};

/**
 * Main indicator class that appears in the panel
 */
const UsageTuiIndicator = GObject.registerClass(
class UsageTuiIndicator extends PanelMenu.Button {
    
    _init() {
        super._init(0.0, 'usage-tui Monitor', false);
        
        this._timeout = null;
        this._usageData = {};
        this._providerRows = {};
        this._lastUpdated = null;
        
        // Build the panel button
        this._buildPanelButton();
        
        // Build the dropdown menu
        this._buildPopupMenu();
        
        // Initial data fetch
        this._refreshData();
        
        // Set up auto-refresh timer
        this._startAutoRefresh();
    }
    
    /**
     * Build the panel button (icon + label in top bar)
     */
    _buildPanelButton() {
        this._panelBox = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });
        
        // Use a generic monitoring icon
        this._icon = new St.Icon({
            icon_name: 'utilities-system-monitor-symbolic',
            style_class: 'system-status-icon',
        });
        
        // Label showing summary
        this._panelLabel = new St.Label({
            text: '...',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-left: 5px;',
        });
        
        this._panelBox.add_child(this._icon);
        this._panelBox.add_child(this._panelLabel);
        this.add_child(this._panelBox);
    }
    
    /**
     * Build the dropdown popup menu with all UI elements
     */
    _buildPopupMenu() {
        // ===== HEADER SECTION =====
        let headerBox = new St.BoxLayout({
            vertical: false,
            style: 'padding: 10px; spacing: 10px;',
        });
        
        let headerIcon = new St.Icon({
            icon_name: 'utilities-system-monitor-symbolic',
            icon_size: 24,
        });
        
        let headerLabel = new St.Label({
            text: 'usage-tui',
            style: 'font-weight: bold; font-size: 1.3em;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        
        headerBox.add_child(headerIcon);
        headerBox.add_child(headerLabel);
        
        let headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        headerItem.add_child(headerBox);
        this.menu.addMenuItem(headerItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // ===== PROVIDERS CONTAINER =====
        this._providersContainer = new St.BoxLayout({
            vertical: true,
            style: 'padding: 10px 15px; spacing: 12px;',
        });
        
        let providersItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        providersItem.add_child(this._providersContainer);
        this.menu.addMenuItem(providersItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // ===== ACTION BUTTONS SECTION =====
        
        // Refresh button
        let refreshItem = new PopupMenu.PopupMenuItem('↻  Refresh Now');
        refreshItem.connect('activate', () => {
            this._refreshData();
        });
        this.menu.addMenuItem(refreshItem);
        
        // Open TUI button
        let openTuiItem = new PopupMenu.PopupMenuItem('📊  Open usage-tui TUI');
        openTuiItem.connect('activate', () => {
            this._openTerminalWithCommand('usage-tui tui');
        });
        this.menu.addMenuItem(openTuiItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // ===== FOOTER SECTION =====
        this._lastUpdatedItem = new PopupMenu.PopupMenuItem('Last updated: Never', {
            reactive: false,
        });
        this._lastUpdatedItem.label.style = 'font-size: 0.85em; color: #666;';
        this.menu.addMenuItem(this._lastUpdatedItem);
    }
    
    /**
     * Create or update a provider card
     */
    _updateProviderCard(providerName, data) {
        let card = this._providerRows[providerName];
        
        if (!card) {
            // Create new card
            card = this._createProviderCard(providerName);
            this._providerRows[providerName] = card;
            this._providersContainer.add_child(card.container);
        }
        
        // Update card with data
        this._populateProviderCard(card, providerName, data);
    }
    
    /**
     * Create a provider card UI
     */
    _createProviderCard(providerName) {
        let color = PROVIDER_COLORS[providerName] || '#888';
        
        // Card container
        let container = new St.BoxLayout({
            vertical: true,
            style: `
                background-color: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                padding: 10px;
                border-left: 3px solid ${color};
            `,
        });
        
        // Provider name header
        let header = new St.Label({
            text: providerName.toUpperCase(),
            style: `
                font-weight: bold;
                font-size: 0.9em;
                color: ${color};
                margin-bottom: 5px;
            `,
        });
        container.add_child(header);
        
        // Progress bar for quota-based providers
        let progressContainer = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 8px; margin-bottom: 5px;',
        });
        
        let progressBg = new St.BoxLayout({
            style: 'background-color: #404040; border-radius: 3px; height: 6px;',
            x_expand: true,
        });
        
        let progressFill = new St.Widget({
            style: `background-color: ${color}; border-radius: 3px; height: 6px; width: 0px;`,
        });
        
        progressBg.add_child(progressFill);
        progressContainer.add_child(progressBg);
        
        let progressLabel = new St.Label({
            text: '',
            style: 'font-size: 0.75em; color: #888; min-width: 35px;',
        });
        progressContainer.add_child(progressLabel);
        
        container.add_child(progressContainer);
        
        // Stats grid
        let statsGrid = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 2px;',
        });
        
        let costLabel = new St.Label({ style: 'font-size: 0.85em;' });
        let requestsLabel = new St.Label({ style: 'font-size: 0.85em;' });
        let tokensLabel = new St.Label({ style: 'font-size: 0.85em;' });
        let resetsLabel = new St.Label({ style: 'font-size: 0.8em; color: #888; margin-top: 3px;' });
        let errorLabel = new St.Label({ style: 'font-size: 0.8em; color: #f44336; margin-top: 3px;' });
        
        statsGrid.add_child(costLabel);
        statsGrid.add_child(requestsLabel);
        statsGrid.add_child(tokensLabel);
        statsGrid.add_child(resetsLabel);
        statsGrid.add_child(errorLabel);
        
        container.add_child(statsGrid);
        
        return {
            container,
            header,
            progressFill,
            progressLabel,
            costLabel,
            requestsLabel,
            tokensLabel,
            resetsLabel,
            errorLabel,
        };
    }
    
    /**
     * Populate provider card with data
     */
    _populateProviderCard(card, providerName, data) {
        const metrics = data.metrics || {};
        const isError = data.error !== null && data.error !== undefined;
        
        if (isError) {
            card.errorLabel.text = `⚠️ ${data.error}`;
            card.errorLabel.show();
            card.costLabel.text = '';
            card.requestsLabel.text = '';
            card.tokensLabel.text = '';
            card.resetsLabel.text = '';
            card.progressFill.style = 'background-color: #f44336; border-radius: 3px; height: 6px; width: 0px;';
            card.progressLabel.text = '';
            return;
        }
        
        card.errorLabel.hide();
        
        // Update progress bar if usage percent available
        if (metrics.usage_percent !== null && metrics.usage_percent !== undefined) {
            let pct = metrics.usage_percent;
            let width = Math.round(pct * 2); // Max 200px
            let color = pct < 50 ? '#4CAF50' : (pct < 80 ? '#ff9800' : '#f44336');
            card.progressFill.style = `
                background-color: ${color};
                border-radius: 3px;
                height: 6px;
                width: ${width}px;
            `;
            card.progressLabel.text = `${pct.toFixed(1)}%`;
        } else {
            card.progressFill.style = 'background-color: #888; border-radius: 3px; height: 6px; width: 0px;';
            card.progressLabel.text = '';
        }
        
        // Update cost
        if (metrics.cost !== null && metrics.cost !== undefined) {
            card.costLabel.text = `💰 $${metrics.cost.toFixed(4)}`;
        } else {
            card.costLabel.text = '';
        }
        
        // Update requests
        if (metrics.requests !== null && metrics.requests !== undefined) {
            card.requestsLabel.text = `📊 ${metrics.requests.toLocaleString()} requests`;
        } else {
            card.requestsLabel.text = '';
        }
        
        // Update tokens
        if (metrics.input_tokens !== null || metrics.output_tokens !== null) {
            let total = (metrics.input_tokens || 0) + (metrics.output_tokens || 0);
            card.tokensLabel.text = `📝 ${total.toLocaleString()} tokens`;
        } else {
            card.tokensLabel.text = '';
        }
        
        // Update reset time
        if (metrics.reset_at) {
            let resetDate = new Date(metrics.reset_at);
            let now = new Date();
            let diffMs = resetDate - now;
            if (diffMs > 0) {
                let hours = Math.floor(diffMs / (1000 * 60 * 60));
                let mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                card.resetsLabel.text = `⏰ Resets in ${hours}h ${mins}m`;
            } else {
                card.resetsLabel.text = '';
            }
        } else {
            card.resetsLabel.text = '';
        }
    }
    
    /**
     * Start the auto-refresh timer
     */
    _startAutoRefresh() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
        }
        
        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this._refreshData();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }
    
    /**
     * Fetch data from usage-tui command
     */
    _refreshData() {
        this._panelLabel.set_text('...');
        
        try {
            let proc = Gio.Subprocess.new(
                ['bash', '-c', COMMAND],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            
            proc.communicate_utf8_async(null, null, (proc, result) => {
                try {
                    let [ok, stdout, stderr] = proc.communicate_utf8_finish(result);
                    
                    if (ok && proc.get_successful() && stdout) {
                        this._parseOutput(stdout.trim());
                        this._updateUI();
                    } else {
                        this._handleError(stderr || 'Command failed');
                    }
                } catch (e) {
                    this._handleError(e.message);
                }
            });
        } catch (e) {
            this._handleError(e.message);
        }
    }
    
    /**
     * Parse the JSON output from usage-tui show --json
     */
    _parseOutput(output) {
        log(`usage-tui: Parsing output`);
        
        try {
            let json = JSON.parse(output);
            this._usageData = json;
            this._lastUpdated = new Date();
            log(`usage-tui: Parsed ${Object.keys(json).length} providers`);
        } catch (e) {
            log(`usage-tui: JSON parse error: ${e.message}`);
            this._handleError(`Parse error: ${e.message}`);
        }
    }
    
    /**
     * Update all UI elements with current data
     */
    _updateUI() {
        let totalCost = 0;
        let configuredProviders = 0;
        
        // Update provider cards
        for (let [providerName, data] of Object.entries(this._usageData)) {
            this._updateProviderCard(providerName, data);
            
            if (data.metrics && data.metrics.cost !== null) {
                totalCost += data.metrics.cost;
                configuredProviders++;
            }
        }
        
        // Update panel label with total cost
        if (configuredProviders > 0) {
            this._panelLabel.set_text(`$${totalCost.toFixed(2)}`);
        } else {
            this._panelLabel.set_text('N/A');
        }
        
        // Update timestamp
        if (this._lastUpdated) {
            let timeString = this._lastUpdated.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
            });
            this._lastUpdatedItem.label.set_text(`Last updated: ${timeString}`);
        }
    }
    
    /**
     * Handle errors gracefully
     */
    _handleError(message) {
        log(`usage-tui Error: ${message}`);
        this._panelLabel.set_text('Err');
        this._lastUpdatedItem.label.set_text(`Error: ${message.substring(0, 40)}`);
    }
    
    /**
     * Open terminal with a command
     */
    _openTerminalWithCommand(command) {
        try {
            Gio.Subprocess.new(
                ['gnome-terminal', '--', 'bash', '-c', `${command}; read -p "Press Enter to close"`],
                Gio.SubprocessFlags.NONE
            );
        } catch (e) {
            log(`usage-tui: Failed to open terminal: ${e.message}`);
        }
    }
    
    /**
     * Clean up when extension is disabled
     */
    destroy() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        
        super.destroy();
    }
});

/**
 * Extension entry point class
 */
export default class UsageTuiExtension {
    constructor() {
        this._indicator = null;
    }
    
    enable() {
        log('usage-tui: Enabling extension');
        this._indicator = new UsageTuiIndicator();
        Main.panel.addToStatusArea('usage-tui', this._indicator, 0, 'right');
    }
    
    disable() {
        log('usage-tui: Disabling extension');
        
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
```

### 5.3 stylesheet.css

```css
/* Custom styles for the usage-tui extension */

/* Panel button styling */
.usage-tui-panel-button {
    padding: 0 8px;
}

/* Provider card styling */
.usage-tui-provider-card {
    background-color: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 10px;
}

.usage-tui-provider-claude {
    border-left: 3px solid #D4A574;
}

.usage-tui-provider-openai {
    border-left: 3px solid #74AA9C;
}

.usage-tui-provider-openrouter {
    border-left: 3px solid #FF6B35;
}

.usage-tui-provider-copilot {
    border-left: 3px solid #6E40C9;
}

.usage-tui-provider-codex {
    border-left: 3px solid #FF6B35;
}

/* Progress bar colors */
.usage-tui-progress-ok {
    background-color: #4CAF50;
}

.usage-tui-progress-warning {
    background-color: #ff9800;
}

.usage-tui-progress-danger {
    background-color: #f44336;
}

/* Stats styling */
.usage-tui-stat-label {
    font-size: 0.85em;
    color: #cccccc;
}

.usage-tui-stat-value {
    font-weight: bold;
    font-family: monospace;
}

/* Error styling */
.usage-tui-error {
    color: #f44336;
    font-size: 0.8em;
}
```

---

## 6. Parsing usage-tui Output

### 6.1 JSON Schema

The extension uses `--json` flag for reliable parsing. The JSON structure is:

```javascript
{
  "<provider_name>": {
    "provider": "<provider_name>",
    "window": "7d|5h|30d",
    "metrics": {
      "cost": float|null,
      "requests": int|null,
      "input_tokens": int|null,
      "output_tokens": int|null,
      "remaining": float|null,      // For quota-based providers
      "limit": float|null,          // For quota-based providers
      "reset_at": "ISO8601 datetime"|null
    },
    "updated_at": "ISO8601 datetime",
    "error": string|null
  }
}
```

### 6.2 Calculated Fields

- **usage_percent**: Calculated as `((limit - remaining) / limit) * 100`
- **total_tokens**: Calculated as `input_tokens + output_tokens`

### 6.3 Handling Errors

When a provider has an error:
- `error` field contains the error message
- `metrics` may be empty or partial
- Display should show error state instead of metrics

---

## 7. Installation

### 7.1 From Repository

```bash
# Navigate to extension directory
cd /home/omegashenr01n/Desktop/Projects/GnomeCodexBar/extension

# Create files (copy from above)
nano metadata.json
nano extension.js
nano stylesheet.css

# Set correct permissions
chmod 644 metadata.json extension.js stylesheet.css
```

### 7.2 Verify Installation

```bash
# List installed extensions
gnome-extensions list

# Check extension info
gnome-extensions info usage-tui@gnome.codexbar
```

### 7.3 Enable the Extension

```bash
# Enable via command line
gnome-extensions enable usage-tui@gnome.codexbar

# Or use the Extensions app
gnome-extensions-app
```

### 7.4 Restart GNOME Shell

On Wayland, log out and log back in. See Section 8 for development workflow alternatives.

---

## 8. Development Workflow on Wayland

### 8.1 Nested GNOME Session (Recommended)

```bash
# Start a nested GNOME Shell session
dbus-run-session -- gnome-shell --nested --wayland
```

This opens a sandboxed GNOME Shell in a window that:
- Uses your existing extensions
- Can be closed and reopened freely
- Shows all logs in the terminal

### 8.2 Development Script

Save as `/home/omegashenr01n/Desktop/Projects/GnomeCodexBar/extension/dev.sh`:

```bash
#!/bin/bash
EXT_UUID="usage-tui@gnome.codexbar"

 case "$1" in
    start)
        echo "Starting nested GNOME Shell..."
        dbus-run-session -- gnome-shell --nested --wayland
        ;;
    enable)
        gnome-extensions enable "$EXT_UUID"
        echo "Extension enabled"
        ;;
    disable)
        gnome-extensions disable "$EXT_UUID"
        echo "Extension disabled"
        ;;
    reload)
        gnome-extensions disable "$EXT_UUID"
        sleep 1
        gnome-extensions enable "$EXT_UUID"
        echo "Extension reloaded"
        ;;
    logs)
        journalctl -f -o cat /usr/bin/gnome-shell | grep -i "usage-tui"
        ;;
    *)
        echo "Usage: $0 {start|enable|disable|reload|logs}"
        exit 1
        ;;
esac
```

```bash
chmod +x dev.sh
./dev.sh start  # Start nested shell
./dev.sh logs   # Watch logs
```

---

## 9. Debugging

### 9.1 View Logs

```bash
# Watch all GNOME Shell logs
journalctl -f -o cat /usr/bin/gnome-shell

# Filter for your extension
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "usage-tui"
```

### 9.2 Using Looking Glass

Press `Alt+F2`, type `lg`, press Enter.

```javascript
// In the Evaluator tab:
// Get extension object
const ext = Main.extensionManager.lookup('usage-tui@gnome.codexbar');

// Check extension state
ext.state  // Should be 1 (ENABLED)

// Reload extension
Main.extensionManager.reloadExtension(ext);
```

---

## 10. Advanced Features

### 10.1 Budget Alerts

Add notifications when approaching limits:

```javascript
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

_sendNotification(title, body) {
    let source = new MessageTray.Source('usage-tui', 'dialog-warning-symbolic');
    Main.messageTray.add(source);
    let notification = new MessageTray.Notification(source, title, body);
    source.showNotification(notification);
}
```

### 10.2 Provider Filtering

Add settings to show only specific providers:

```javascript
// In _refreshData()
const COMMAND = this._settings.get_boolean('show-all-providers') 
    ? 'usage-tui show --json'
    : 'usage-tui show --provider claude --json';
```

### 10.3 Click Actions

Make provider cards clickable:

```javascript
providerCard.connect('button-press-event', () => {
    this._openTerminalWithCommand(`usage-tui show --provider ${providerName}`);
});
```

---

## 11. Troubleshooting

### Extension Not Loading

1. **Check UUID matches directory name:**
   ```bash
   ls ~/.local/share/gnome-shell/extensions/
   # Should show: usage-tui@gnome.codexbar
   
   grep uuid ~/.local/share/gnome-shell/extensions/usage-tui@gnome.codexbar/metadata.json
   ```

2. **Verify GNOME Shell version compatibility:**
   ```bash
   gnome-shell --version
   # Ensure version is in metadata.json shell-version array
   ```

3. **Check for syntax errors:**
   ```bash
   gjs -c "import '~/.local/share/gnome-shell/extensions/usage-tui@gnome.codexbar/extension.js'"
   ```

### usage-tui Not Found

If `usage-tui` isn't in PATH when running from the extension:

```javascript
// Use full path in extension.js
const COMMAND = '/home/omegashenr01n/.local/bin/usage-tui show --json';

// Or
const COMMAND = '/usr/local/bin/usage-tui show --json';
```

Find the path:
```bash
which usage-tui
```

### Permission Errors

```bash
chmod 644 ~/.local/share/gnome-shell/extensions/usage-tui@gnome.codexbar/*
```

---

## Quick Reference

```bash
# Extension management
gnome-extensions list
gnome-extensions enable usage-tui@gnome.codexbar
gnome-extensions disable usage-tui@gnome.codexbar
gnome-extensions info usage-tui@gnome.codexbar

# Development
dbus-run-session -- gnome-shell --nested --wayland
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "usage-tui"

# Debugging
Alt+F2 → lg  # Open Looking Glass
```

---

**Next Steps:**
1. Create the extension directory structure
2. Copy the code from this guide
3. Test with the nested GNOME Shell session
4. Customize styling and features as needed
