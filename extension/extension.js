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
const USAGE_TUI_PATH = '/home/omegashenr01n/miniconda3/bin/usage-tui';
const ENV_FILE_PATH = GLib.get_home_dir() + '/.config/usage-tui/env';

/**
 * Load environment variables from ~/.config/usage-tui/env
 * Supports lines like KEY=value or export KEY=value
 * Skips comments and empty lines. Does not log secrets.
 * @returns {Object} - Map of env var names to values
 */
function _loadEnvFromFile() {
    let env = {};

    try {
        let [ok, contents] = GLib.file_get_contents(ENV_FILE_PATH);
        if (!ok || !contents) {
            return env;
        }

        // Convert Uint8Array to string using TextDecoder (GLib returns Uint8Array)
        let text;
        if (contents instanceof Uint8Array) {
            text = new TextDecoder('utf-8').decode(contents);
        } else {
            text = contents.toString();
        }

        let lines = text.split('\n');

        for (let line of lines) {
            let trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Remove inline comments
            let hashIndex = trimmed.indexOf('#');
            if (hashIndex !== -1) {
                // Check if # is inside quotes (simple check)
                let beforeHash = trimmed.slice(0, hashIndex);
                let singleQuotes = (beforeHash.match(/'/g) || []).length;
                let doubleQuotes = (beforeHash.match(/"/g) || []).length;
                if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
                    trimmed = beforeHash.trim();
                }
            }

            // Match: export KEY=value or KEY=value
            let match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (!match) {
                continue;
            }

            let name = match[1];
            let value = match[2].trim();

            // Remove trailing semicolon
            if (value.endsWith(';')) {
                value = value.slice(0, -1).trim();
            }

            // Remove surrounding quotes
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            if (value) {
                env[name] = value;
            }
        }
    } catch (e) {
        // File missing or unreadable - continue gracefully
        return env;
    }

    return env;
}

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
        let refreshItem = new PopupMenu.PopupMenuItem('Refresh Now');
        refreshItem.connect('activate', () => {
            this._refreshData();
        });
        this.menu.addMenuItem(refreshItem);
        
        // Open TUI button
        let openTuiItem = new PopupMenu.PopupMenuItem('Open usage-tui TUI');
        openTuiItem.connect('activate', () => {
            this._openTerminalWithCommand(`${USAGE_TUI_PATH} tui`);
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

        // Window-specific progress bars (5h / 7d)
        const createWindowBar = (labelText) => {
            let row = new St.BoxLayout({
                vertical: false,
                style: 'spacing: 6px;'
            });

            let label = new St.Label({
                text: labelText,
                style: 'font-size: 0.75em; color: #888; min-width: 24px;'
            });

            let barBg = new St.BoxLayout({
                style: 'background-color: #404040; border-radius: 3px; height: 6px;',
                x_expand: true,
            });

            let barFill = new St.Widget({
                style: `background-color: ${color}; border-radius: 3px; height: 6px; width: 0px;`,
            });

            let pctLabel = new St.Label({
                text: '',
                style: 'font-size: 0.75em; color: #888; min-width: 35px;'
            });

            barBg.add_child(barFill);
            row.add_child(label);
            row.add_child(barBg);
            row.add_child(pctLabel);
            row.hide();

            return { row, barFill, pctLabel };
        };

        let windowBars = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 4px; margin-bottom: 5px;',
        });

        let fiveHourBar = createWindowBar('5h');
        let sevenDayBar = createWindowBar('7d');

        windowBars.add_child(fiveHourBar.row);
        windowBars.add_child(sevenDayBar.row);
        windowBars.hide();

        container.add_child(windowBars);
        
        // Stats grid
        let statsGrid = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 2px;',
        });
        
        let costLabel = new St.Label({ style: 'font-size: 0.85em;' });
        let byokLabel = new St.Label({ style: 'font-size: 0.85em;' });
        let requestsLabel = new St.Label({ style: 'font-size: 0.85em;' });
        let tokensLabel = new St.Label({ style: 'font-size: 0.85em;' });
        let resetsLabel = new St.Label({ style: 'font-size: 0.8em; color: #888; margin-top: 3px;' });
        let errorLabel = new St.Label({ style: 'font-size: 0.8em; color: #f44336; margin-top: 3px;' });
        
        statsGrid.add_child(costLabel);
        statsGrid.add_child(byokLabel);
        statsGrid.add_child(requestsLabel);
        statsGrid.add_child(tokensLabel);
        statsGrid.add_child(resetsLabel);
        statsGrid.add_child(errorLabel);
        
        container.add_child(statsGrid);
        
        return {
            container,
            header,
            progressContainer,
            progressFill,
            progressLabel,
            windowBars,
            fiveHourBar,
            sevenDayBar,
            costLabel,
            byokLabel,
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
            card.byokLabel.text = '';
            card.requestsLabel.text = '';
            card.tokensLabel.text = '';
            card.resetsLabel.text = '';
            card.progressFill.style = 'background-color: #f44336; border-radius: 3px; height: 6px; width: 0px;';
            card.progressLabel.text = '';
            card.windowBars.hide();
            card.fiveHourBar.row.hide();
            card.sevenDayBar.row.hide();
            card.progressContainer.show();
            return;
        }
        
        card.errorLabel.hide();
        
        const raw = data.raw || {};
        const fiveHourUtil = raw.five_hour && raw.five_hour.utilization !== null && raw.five_hour.utilization !== undefined
            ? raw.five_hour.utilization
            : (raw.rate_limit && raw.rate_limit.primary_window && raw.rate_limit.primary_window.used_percent !== null && raw.rate_limit.primary_window.used_percent !== undefined
                ? raw.rate_limit.primary_window.used_percent
                : null);
        const sevenDayUtil = raw.seven_day && raw.seven_day.utilization !== null && raw.seven_day.utilization !== undefined
            ? raw.seven_day.utilization
            : (raw.rate_limit && raw.rate_limit.secondary_window && raw.rate_limit.secondary_window.used_percent !== null && raw.rate_limit.secondary_window.used_percent !== undefined
                ? raw.rate_limit.secondary_window.used_percent
                : null);

        const getProgressColor = (pct) => {
            if (pct < 50) {
                return '#4CAF50';
            }
            if (pct < 80) {
                return '#ff9800';
            }
            return '#f44336';
        };

        const updateWindowBar = (bar, pct) => {
            let width = Math.round(pct * 2);
            let color = getProgressColor(pct);
            bar.barFill.style = `
                background-color: ${color};
                border-radius: 3px;
                height: 6px;
                width: ${width}px;
            `;
            bar.pctLabel.text = `${pct.toFixed(1)}%`;
            bar.row.show();
        };

        let hasWindowBars = false;
        if (fiveHourUtil !== null) {
            updateWindowBar(card.fiveHourBar, fiveHourUtil);
            hasWindowBars = true;
        } else {
            card.fiveHourBar.row.hide();
        }

        if (sevenDayUtil !== null) {
            updateWindowBar(card.sevenDayBar, sevenDayUtil);
            hasWindowBars = true;
        } else {
            card.sevenDayBar.row.hide();
        }

        if (hasWindowBars) {
            card.windowBars.show();
            card.progressContainer.hide();
        } else {
            card.windowBars.hide();
            card.progressContainer.show();
        }

        // Calculate usage percent from remaining/limit if not provided
        let usagePercent = metrics.usage_percent;
        if ((usagePercent === null || usagePercent === undefined) &&
            metrics.limit !== null && metrics.limit !== undefined &&
            metrics.remaining !== null && metrics.remaining !== undefined) {
            usagePercent = ((metrics.limit - metrics.remaining) / metrics.limit) * 100;
        }

        // Update progress bar if usage percent available
        if (!hasWindowBars) {
            if (usagePercent !== null && usagePercent !== undefined) {
                let pct = usagePercent;
                let width = Math.round(pct * 2); // Max 200px
                let color = getProgressColor(pct);
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
        }
        
        // Update cost or quota info
        if (metrics.cost !== null && metrics.cost !== undefined) {
            // For openrouter, show usage/limit in dollars when limit is present
            if (providerName === 'openrouter' && metrics.limit !== null && metrics.limit !== undefined) {
                card.costLabel.text = `$${metrics.cost.toFixed(4)} / $${metrics.limit.toFixed(2)}`;
            } else {
                card.costLabel.text = `$${metrics.cost.toFixed(4)}`;
            }
        } else if (metrics.remaining !== null && metrics.limit !== null) {
            // Show quota usage for providers without cost
            card.costLabel.text = `${metrics.remaining.toFixed(1)} / ${metrics.limit.toFixed(1)} credits`;
        } else {
            card.costLabel.text = '';
        }
        
        // Update BYOK usage for openrouter
        if (providerName === 'openrouter' && raw.data) {
            let byokValue = null;
            if (data.window === '5h') {
                byokValue = raw.data.byok_usage_daily;
            } else if (data.window === '30d') {
                byokValue = raw.data.byok_usage_monthly;
            } else {
                byokValue = raw.data.byok_usage_weekly;
            }
            if (byokValue !== null && byokValue !== undefined && byokValue > 0) {
                card.byokLabel.text = `BYOK: $${byokValue.toFixed(4)}`;
            } else {
                card.byokLabel.text = '';
            }
        } else {
            card.byokLabel.text = '';
        }
        
        // Update requests
        if (metrics.requests !== null && metrics.requests !== undefined) {
            card.requestsLabel.text = `${metrics.requests.toLocaleString()} requests`;
        } else {
            card.requestsLabel.text = '';
        }
        
        // Update tokens
        if (metrics.input_tokens !== null || metrics.output_tokens !== null) {
            let total = (metrics.input_tokens || 0) + (metrics.output_tokens || 0);
            card.tokensLabel.text = `${total.toLocaleString()} tokens`;
        } else {
            card.tokensLabel.text = '';
        }
        
        // Update reset time
        if (metrics.reset_at) {
            let resetDate = new Date(metrics.reset_at);
            let now = new Date();
            let diffMs = resetDate - now;
            if (diffMs > 0) {
                let days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                let hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                let mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                if (days > 0) {
                    card.resetsLabel.text = `Resets in ${days}d ${hours}h ${mins}m`;
                } else {
                    card.resetsLabel.text = `Resets in ${hours}h ${mins}m`;
                }
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
            let launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });

            let envFromFile = _loadEnvFromFile();
            for (let [key, value] of Object.entries(envFromFile)) {
                launcher.setenv(key, value, true);
            }

            let proc = launcher.spawnv([USAGE_TUI_PATH, 'show', '--json']);
            
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
        let hasCostData = false;
        let configuredProviders = 0;
        
        // Update provider cards
        const providerOrder = ['claude', 'openai', 'openrouter', 'copilot', 'codex'];
        const entries = Object.entries(this._usageData).sort((a, b) => {
            const aIndex = providerOrder.indexOf(a[0]);
            const bIndex = providerOrder.indexOf(b[0]);
            const aRank = aIndex === -1 ? 999 : aIndex;
            const bRank = bIndex === -1 ? 999 : bIndex;
            if (aRank !== bRank) {
                return aRank - bRank;
            }
            return a[0].localeCompare(b[0]);
        });

        for (let [providerName, data] of entries) {
            this._updateProviderCard(providerName, data);
            
            // Provider has cost data
            if (data.metrics && data.metrics.cost !== null && data.metrics.cost !== undefined) {
                totalCost += data.metrics.cost;
                hasCostData = true;
                configuredProviders++;
            }
            // Provider has quota data (remaining/limit)
            else if (data.metrics && (data.metrics.remaining !== null || data.metrics.limit !== null)) {
                configuredProviders++;
            }
        }
        
        // Update panel label
        if (hasCostData) {
            this._panelLabel.set_text(`$${totalCost.toFixed(2)}`);
        } else if (configuredProviders > 0) {
            this._panelLabel.set_text(`${configuredProviders} active`);
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
                ['gnome-terminal', '--', 'bash', '-c', command + '; read -p "Press Enter to close"'],
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
