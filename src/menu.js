/**
 * menu.js - Popup menu builder for CodexBar
 * 
 * Builds the dropdown menu showing provider details,
 * usage bars, reset times, and action buttons.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Provider icon mapping (symbolic icons)
const PROVIDER_ICONS = {
    'codex': 'application-x-executable-symbolic',
    'claude': 'user-available-symbolic',
    'cursor': 'edit-symbolic',
    'gemini': 'starred-symbolic',
    'copilot': 'system-software-install-symbolic',
    'opencode': 'utilities-terminal-symbolic',
    'kimi': 'weather-clear-symbolic',
    'kimik2': 'weather-clear-symbolic',
    'kiro': 'emblem-synchronizing-symbolic',
    'zai': 'network-server-symbolic',
    'factory': 'applications-engineering-symbolic',
    'augment': 'list-add-symbolic',
    'amp': 'audio-volume-high-symbolic',
    'antigravity': 'go-up-symbolic',
    'jetbrains': 'applications-development-symbolic',
    'vertex': 'network-workgroup-symbolic',
    'minimax': 'view-grid-symbolic',
    'synthetic': 'applications-science-symbolic',
};

export class CodexBarMenu {
    constructor(indicator, extension) {
        this._indicator = indicator;
        this._extension = extension;
        this._menu = indicator.menu;
        
        // Build initial menu structure
        this._buildMenuStructure();
    }

    /**
     * Build the static menu structure
     */
    _buildMenuStructure() {
        // Header section
        this._headerSection = new PopupMenu.PopupMenuSection();
        this._menu.addMenuItem(this._headerSection);
        
        // Separator
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Provider section
        this._providerSection = new PopupMenu.PopupMenuSection();
        this._menu.addMenuItem(this._providerSection);
        
        // Separator
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Footer section
        this._footerSection = new PopupMenu.PopupMenuSection();
        this._menu.addMenuItem(this._footerSection);
    }

    /**
     * Rebuild menu content
     */
    rebuildMenu() {
        // Clear sections
        this._headerSection.removeAll();
        this._providerSection.removeAll();
        this._footerSection.removeAll();
        
        // Build header
        this._buildHeader();
        
        // Build provider rows
        const providers = this._extension.providers;
        const error = this._extension.lastError;
        const state = this._extension.state;
        
        if (state === 'error' && !providers) {
            this._buildErrorState(error);
        } else if (!providers || providers.length === 0) {
            this._buildEmptyState();
        } else {
            this._buildProviderRows(providers);
        }
        
        // Build footer
        this._buildFooter();
    }

    /**
     * Build header row
     */
    _buildHeader() {
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        
        const headerBox = new St.BoxLayout({
            x_expand: true,
            style_class: 'codexbar-menu-header',
        });
        
        // Title
        const title = new St.Label({
            text: 'CodexBar',
            style_class: 'codexbar-menu-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(title);
        
        // Updated time
        const timestamp = this._extension.cacheTimestamp;
        if (timestamp > 0) {
            const age = this._formatAge(timestamp);
            const updatedLabel = new St.Label({
                text: `Updated ${age}`,
                style_class: 'codexbar-menu-updated',
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.add_child(updatedLabel);
        }
        
        headerItem.add_child(headerBox);
        this._headerSection.addMenuItem(headerItem);
    }

    /**
     * Build provider rows
     */
    _buildProviderRows(providers) {
        // Get visibility settings
        let visibilityMap = {};
        try {
            const visStr = this._extension.settings?.get_string('provider-visibility');
            if (visStr) visibilityMap = JSON.parse(visStr);
        } catch (e) {
            // Use empty map
        }
        
        // Filter visible providers
        let visibleProviders = providers.filter(p => {
            const vis = visibilityMap[p.id];
            // Default to visible if not in map
            return vis === undefined || vis === true;
        });
        
        // Sort providers
        const sortMode = this._extension.settings?.get_string('sort-mode') || 'urgent';
        if (sortMode === 'urgent') {
            visibleProviders.sort((a, b) => {
                const aMin = this._getMinPercent(a);
                const bMin = this._getMinPercent(b);
                return aMin - bMin;
            });
        } else {
            visibleProviders.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        // Build rows
        for (const provider of visibleProviders) {
            this._buildProviderRow(provider);
        }
    }

    /**
     * Get minimum remaining percent for a provider
     */
    _getMinPercent(provider) {
        let min = 100;
        const windows = [provider.primary, provider.secondary, provider.tertiary].filter(w => w);
        for (const w of windows) {
            if (w.remainingPercent < min) {
                min = w.remainingPercent;
            }
        }
        return min;
    }

    /**
     * Build a single provider row
     */
    _buildProviderRow(provider) {
        const menuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: true,
        });
        
        // Determine visual state
        const minPercent = this._getMinPercent(provider);
        const warningThreshold = this._extension.settings?.get_int('warning-threshold') || 20;
        const criticalThreshold = this._extension.settings?.get_int('critical-threshold') || 5;
        
        let visualState = 'normal';
        if (provider.error) {
            visualState = 'error';
        } else if (minPercent <= criticalThreshold) {
            visualState = 'critical';
        } else if (minPercent <= warningThreshold) {
            visualState = 'warning';
        }
        
        const container = new St.BoxLayout({
            vertical: true,
            style_class: `codexbar-provider-row codexbar-${visualState}`,
            x_expand: true,
        });
        
        // === Header row ===
        const headerBox = new St.BoxLayout({
            style_class: 'codexbar-provider-header',
            x_expand: true,
        });
        
        // Icon
        const iconName = PROVIDER_ICONS[provider.id] || 'application-x-addon-symbolic';
        const icon = new St.Icon({
            icon_name: iconName,
            style_class: `codexbar-provider-icon codexbar-${visualState}`,
            icon_size: 16,
        });
        headerBox.add_child(icon);
        
        // Name + version
        let nameText = provider.name;
        if (provider.version) {
            nameText += ` ${provider.version}`;
        }
        const nameLabel = new St.Label({
            text: nameText,
            style_class: 'codexbar-provider-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(nameLabel);
        
        // Percentage
        const percentText = provider.error ? '--' : `${Math.round(minPercent)}%`;
        const percentLabel = new St.Label({
            text: percentText,
            style_class: `codexbar-provider-percentage codexbar-${visualState}`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(percentLabel);
        
        container.add_child(headerBox);
        
        // === Details section ===
        const detailsBox = new St.BoxLayout({
            vertical: true,
            style_class: 'codexbar-provider-details',
        });
        
        // Error message
        if (provider.error) {
            const errorLabel = new St.Label({
                text: provider.error.message || 'Error fetching data',
                style_class: 'codexbar-provider-error',
            });
            detailsBox.add_child(errorLabel);
        } else {
            // Usage windows
            const windows = [
                { data: provider.primary, label: 'Session' },
                { data: provider.secondary, label: 'Weekly' },
                { data: provider.tertiary, label: 'Tertiary' },
            ];
            
            for (const { data, label } of windows) {
                if (data) {
                    this._buildWindowRow(detailsBox, data, label, visualState);
                }
            }
            
            // Credits
            if (provider.credits) {
                const creditsLabel = new St.Label({
                    text: `Credits: ${provider.credits.remaining} remaining`,
                    style_class: 'codexbar-provider-usage',
                });
                detailsBox.add_child(creditsLabel);
            }
            
            // Account info
            if (provider.account) {
                const accountLabel = new St.Label({
                    text: `Account: ${provider.account}`,
                    style_class: 'codexbar-provider-usage',
                });
                detailsBox.add_child(accountLabel);
            }
            
            // Plan/tier
            if (provider.plan) {
                const planLabel = new St.Label({
                    text: `Plan: ${provider.plan}`,
                    style_class: 'codexbar-provider-usage',
                });
                detailsBox.add_child(planLabel);
            }
            
            // Status
            if (provider.status) {
                const statusIcon = provider.status.indicator === 'operational' ? '✓' : '⚠';
                const statusLabel = new St.Label({
                    text: `Status: ${statusIcon} ${provider.status.description || provider.status.indicator}`,
                    style_class: `codexbar-provider-status codexbar-status-${provider.status.indicator}`,
                });
                detailsBox.add_child(statusLabel);
            }
        }
        
        container.add_child(detailsBox);
        menuItem.add_child(container);
        this._providerSection.addMenuItem(menuItem);
    }

    /**
     * Build a usage window row with progress bar
     */
    _buildWindowRow(parent, window, label, visualState) {
        const rowBox = new St.BoxLayout({
            style_class: 'codexbar-window-row',
            x_expand: true,
        });
        
        // Label
        const labelWidget = new St.Label({
            text: `${label}:`,
            style_class: 'codexbar-window-label',
            x_align: Clutter.ActorAlign.START,
        });
        rowBox.add_child(labelWidget);
        
        // Percentage
        const percentWidget = new St.Label({
            text: `${Math.round(window.remainingPercent)}%`,
            style_class: `codexbar-window-percent codexbar-${visualState}`,
        });
        rowBox.add_child(percentWidget);
        
        // Progress bar container
        const barContainer = new St.BoxLayout({
            style_class: 'codexbar-progress-container',
            x_expand: true,
        });
        
        // Progress bar background
        const barBg = new St.Widget({
            style_class: 'codexbar-progress-bg',
            x_expand: true,
        });
        barContainer.add_child(barBg);
        
        // Progress bar fill
        const fillWidth = Math.max(0, Math.min(100, window.remainingPercent));
        const barFill = new St.Widget({
            style_class: `codexbar-progress-fill codexbar-${visualState}`,
            width: fillWidth,
        });
        barBg.add_child(barFill);
        
        rowBox.add_child(barContainer);
        
        // Reset time
        if (window.resetsAt || window.resetDescription) {
            const resetText = this._formatResetTime(window);
            const resetWidget = new St.Label({
                text: `→ ${resetText}`,
                style_class: 'codexbar-window-reset',
            });
            rowBox.add_child(resetWidget);
        }
        
        parent.add_child(rowBox);
    }

    /**
     * Format reset time
     */
    _formatResetTime(window) {
        if (window.resetDescription) {
            return window.resetDescription;
        }
        
        if (!window.resetsAt) {
            return 'N/A';
        }
        
        const mode = this._extension.settings?.get_string('reset-display-mode') || 'countdown';
        const resetTime = new Date(window.resetsAt).getTime();
        
        if (mode === 'absolute') {
            return new Date(resetTime).toLocaleString();
        }
        
        // Countdown mode
        const now = Date.now();
        const diff = resetTime - now;
        
        if (diff < 0) return 'soon';
        
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    /**
     * Build empty state
     */
    _buildEmptyState() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        
        const container = new St.BoxLayout({
            vertical: true,
            style_class: 'codexbar-empty-state',
            x_expand: true,
        });
        
        const icon = new St.Icon({
            icon_name: 'dialog-information-symbolic',
            style_class: 'codexbar-empty-icon',
            icon_size: 48,
        });
        container.add_child(icon);
        
        const title = new St.Label({
            text: 'No providers configured',
            style_class: 'codexbar-empty-title',
        });
        container.add_child(title);
        
        const desc = new St.Label({
            text: 'Install codexbar CLI and configure providers\nto monitor your AI usage limits.',
            style_class: 'codexbar-empty-description',
        });
        container.add_child(desc);
        
        item.add_child(container);
        this._providerSection.addMenuItem(item);
    }

    /**
     * Build error state
     */
    _buildErrorState(error) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        
        const container = new St.BoxLayout({
            vertical: true,
            style_class: 'codexbar-empty-state',
            x_expand: true,
        });
        
        const icon = new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            style_class: 'codexbar-error-icon',
            icon_size: 48,
        });
        container.add_child(icon);
        
        const title = new St.Label({
            text: 'Unable to fetch data',
            style_class: 'codexbar-empty-title',
        });
        container.add_child(title);
        
        const desc = new St.Label({
            text: error || 'Check your codexbar CLI installation.',
            style_class: 'codexbar-empty-description',
        });
        container.add_child(desc);
        
        item.add_child(container);
        this._providerSection.addMenuItem(item);
    }

    /**
     * Build footer with action buttons
     */
    _buildFooter() {
        const footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        
        const footerBox = new St.BoxLayout({
            style_class: 'codexbar-menu-footer',
            x_expand: true,
        });
        
        // Refresh button
        const refreshButton = new St.Button({
            style_class: 'codexbar-action-button',
            can_focus: true,
        });
        const refreshBox = new St.BoxLayout();
        refreshBox.add_child(new St.Icon({
            icon_name: 'view-refresh-symbolic',
            icon_size: 14,
        }));
        refreshBox.add_child(new St.Label({ text: ' Refresh' }));
        refreshButton.set_child(refreshBox);
        refreshButton.connect('clicked', () => {
            this._extension.manualRefresh();
            this._menu.close();
        });
        footerBox.add_child(refreshButton);
        
        // Spacer
        const spacer = new St.Widget({ x_expand: true });
        footerBox.add_child(spacer);
        
        // Open Config button
        const configButton = new St.Button({
            style_class: 'codexbar-action-button',
            can_focus: true,
        });
        const configBox = new St.BoxLayout();
        configBox.add_child(new St.Icon({
            icon_name: 'document-open-symbolic',
            icon_size: 14,
        }));
        configBox.add_child(new St.Label({ text: ' Config' }));
        configButton.set_child(configBox);
        configButton.connect('clicked', () => {
            const configPath = GLib.build_filenamev([GLib.get_home_dir(), '.codexbar', 'config.json']);
            try {
                Gio.AppInfo.launch_default_for_uri(`file://${configPath}`, null);
            } catch (e) {
                console.error(`[CodexBar] Failed to open config: ${e.message}`);
            }
            this._menu.close();
        });
        footerBox.add_child(configButton);
        
        // Settings button
        const settingsButton = new St.Button({
            style_class: 'codexbar-action-button',
            can_focus: true,
        });
        const settingsBox = new St.BoxLayout();
        settingsBox.add_child(new St.Icon({
            icon_name: 'emblem-system-symbolic',
            icon_size: 14,
        }));
        settingsBox.add_child(new St.Label({ text: ' Settings' }));
        settingsButton.set_child(settingsBox);
        settingsButton.connect('clicked', () => {
            try {
                const extensionManager = imports.ui.main.extensionManager;
                extensionManager.openExtensionPrefs(
                    'gnome-codexbar@codexbar.app',
                    '',
                    {}
                );
            } catch (e) {
                console.error(`[CodexBar] Failed to open prefs: ${e.message}`);
            }
            this._menu.close();
        });
        footerBox.add_child(settingsButton);
        
        footerItem.add_child(footerBox);
        this._footerSection.addMenuItem(footerItem);
    }

    /**
     * Format age from timestamp
     */
    _formatAge(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const diff = now - timestamp;
        
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    /**
     * Destroy the menu
     */
    destroy() {
        // Menu items are destroyed with the indicator
    }
}
