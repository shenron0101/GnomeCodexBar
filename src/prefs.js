/**
 * prefs.js - Preferences UI for CodexBar
 * 
 * Uses Adw.PreferencesWindow for GNOME 46+ compatibility.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CodexBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        // === Refresh Settings Page ===
        const refreshPage = new Adw.PreferencesPage({
            title: 'Refresh',
            icon_name: 'view-refresh-symbolic',
        });
        window.add(refreshPage);
        
        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Refresh Settings',
            description: 'Configure how often CodexBar fetches usage data',
        });
        refreshPage.add(refreshGroup);
        
        // Refresh interval dropdown
        const intervalRow = new Adw.ComboRow({
            title: 'Refresh Interval',
            subtitle: 'How often to poll the codexbar CLI',
        });
        const intervalModel = new Gtk.StringList();
        const intervals = [
            { label: '1 minute', value: 60 },
            { label: '2 minutes', value: 120 },
            { label: '5 minutes (default)', value: 300 },
            { label: '15 minutes', value: 900 },
            { label: '30 minutes', value: 1800 },
        ];
        intervals.forEach(i => intervalModel.append(i.label));
        intervalRow.set_model(intervalModel);
        
        // Set initial selection
        const currentInterval = settings.get_int('refresh-interval');
        const intervalIndex = intervals.findIndex(i => i.value === currentInterval);
        intervalRow.set_selected(intervalIndex >= 0 ? intervalIndex : 2);
        
        intervalRow.connect('notify::selected', () => {
            const selected = intervals[intervalRow.get_selected()];
            if (selected) {
                settings.set_int('refresh-interval', selected.value);
            }
        });
        refreshGroup.add(intervalRow);
        
        // Refresh on menu open
        const refreshOnOpenRow = new Adw.SwitchRow({
            title: 'Refresh on Menu Open',
            subtitle: 'Fetch fresh data when the menu is opened',
        });
        settings.bind('refresh-on-open', refreshOnOpenRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(refreshOnOpenRow);
        
        // === Display Settings Page ===
        const displayPage = new Adw.PreferencesPage({
            title: 'Display',
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(displayPage);
        
        const displayGroup = new Adw.PreferencesGroup({
            title: 'Panel Display',
            description: 'Customize the panel indicator appearance',
        });
        displayPage.add(displayGroup);
        
        // Show text in panel
        const showTextRow = new Adw.SwitchRow({
            title: 'Show Percentage Text',
            subtitle: 'Display percentage next to the icon',
        });
        settings.bind('show-text', showTextRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showTextRow);
        
        // Show badge
        const showBadgeRow = new Adw.SwitchRow({
            title: 'Show Warning Badge',
            subtitle: 'Display badge for providers in warning/critical state',
        });
        settings.bind('show-badge', showBadgeRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showBadgeRow);
        
        // Reset display mode
        const resetModeRow = new Adw.ComboRow({
            title: 'Reset Time Display',
            subtitle: 'How to show reset times',
        });
        const resetModeModel = new Gtk.StringList();
        resetModeModel.append('Countdown (e.g., 2h 30m)');
        resetModeModel.append('Absolute (e.g., 3:00 PM)');
        resetModeRow.set_model(resetModeModel);
        resetModeRow.set_selected(settings.get_string('reset-display-mode') === 'absolute' ? 1 : 0);
        resetModeRow.connect('notify::selected', () => {
            settings.set_string('reset-display-mode',
                resetModeRow.get_selected() === 1 ? 'absolute' : 'countdown');
        });
        displayGroup.add(resetModeRow);
        
        // Sort mode
        const sortModeRow = new Adw.ComboRow({
            title: 'Sort Providers By',
            subtitle: 'Order of providers in the menu',
        });
        const sortModeModel = new Gtk.StringList();
        sortModeModel.append('Most Urgent (lowest remaining first)');
        sortModeModel.append('Alphabetical');
        sortModeRow.set_model(sortModeModel);
        sortModeRow.set_selected(settings.get_string('sort-mode') === 'alphabetical' ? 1 : 0);
        sortModeRow.connect('notify::selected', () => {
            settings.set_string('sort-mode',
                sortModeRow.get_selected() === 1 ? 'alphabetical' : 'urgent');
        });
        displayGroup.add(sortModeRow);
        
        // Thresholds group
        const thresholdsGroup = new Adw.PreferencesGroup({
            title: 'Warning Thresholds',
            description: 'Percentage thresholds for warning and critical states',
        });
        displayPage.add(thresholdsGroup);
        
        // Warning threshold
        const warningRow = new Adw.SpinRow({
            title: 'Warning Threshold',
            subtitle: 'Percentage below which providers show warning',
        });
        warningRow.set_adjustment(new Gtk.Adjustment({
            lower: 5,
            upper: 50,
            step_increment: 5,
            value: settings.get_int('warning-threshold'),
        }));
        warningRow.connect('notify::value', () => {
            settings.set_int('warning-threshold', warningRow.get_value());
        });
        thresholdsGroup.add(warningRow);
        
        // Critical threshold
        const criticalRow = new Adw.SpinRow({
            title: 'Critical Threshold',
            subtitle: 'Percentage below which providers show critical',
        });
        criticalRow.set_adjustment(new Gtk.Adjustment({
            lower: 1,
            upper: 20,
            step_increment: 1,
            value: settings.get_int('critical-threshold'),
        }));
        criticalRow.connect('notify::value', () => {
            settings.set_int('critical-threshold', criticalRow.get_value());
        });
        thresholdsGroup.add(criticalRow);
        
        // === Providers Page ===
        const providersPage = new Adw.PreferencesPage({
            title: 'Providers',
            icon_name: 'view-list-symbolic',
        });
        window.add(providersPage);
        
        const providersGroup = new Adw.PreferencesGroup({
            title: 'Provider Visibility',
            description: 'Toggle which providers are shown in the menu.\nTo add/remove providers, edit ~/.codexbar/config.json',
        });
        providersPage.add(providersGroup);
        
        // Load provider visibility
        let visibilityMap = {};
        try {
            const visStr = settings.get_string('provider-visibility');
            if (visStr) visibilityMap = JSON.parse(visStr);
        } catch (e) {
            // Use empty map
        }
        
        // List of known providers
        const knownProviders = [
            { id: 'codex', name: 'Codex' },
            { id: 'claude', name: 'Claude Code' },
            { id: 'cursor', name: 'Cursor' },
            { id: 'gemini', name: 'Gemini' },
            { id: 'copilot', name: 'GitHub Copilot' },
            { id: 'opencode', name: 'OpenCode' },
            { id: 'kimi', name: 'Kimi' },
            { id: 'kimik2', name: 'Kimi K2' },
            { id: 'kiro', name: 'Kiro' },
            { id: 'zai', name: 'z.ai' },
            { id: 'factory', name: 'Factory/Droid' },
            { id: 'augment', name: 'Augment' },
            { id: 'amp', name: 'Amp' },
            { id: 'antigravity', name: 'Antigravity' },
            { id: 'jetbrains', name: 'JetBrains AI' },
            { id: 'vertex', name: 'Vertex AI' },
            { id: 'minimax', name: 'MiniMax' },
        ];
        
        for (const provider of knownProviders) {
            const row = new Adw.SwitchRow({
                title: provider.name,
                subtitle: `Show ${provider.id} in the menu`,
            });
            
            // Default to visible if not in map
            row.set_active(visibilityMap[provider.id] !== false);
            
            row.connect('notify::active', () => {
                visibilityMap[provider.id] = row.get_active();
                settings.set_string('provider-visibility', JSON.stringify(visibilityMap));
            });
            
            providersGroup.add(row);
        }
        
        // Open config button
        const configGroup = new Adw.PreferencesGroup();
        providersPage.add(configGroup);
        
        const configRow = new Adw.ActionRow({
            title: 'Edit Configuration',
            subtitle: '~/.codexbar/config.json',
            activatable: true,
        });
        configRow.add_suffix(new Gtk.Image({
            icon_name: 'document-open-symbolic',
        }));
        configRow.connect('activated', () => {
            const configPath = GLib.build_filenamev([GLib.get_home_dir(), '.codexbar', 'config.json']);
            try {
                Gio.AppInfo.launch_default_for_uri(`file://${configPath}`, null);
            } catch (e) {
                console.error(`[CodexBar] Failed to open config: ${e.message}`);
            }
        });
        configGroup.add(configRow);
        
        // === Advanced Settings Page ===
        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(advancedPage);
        
        const advancedGroup = new Adw.PreferencesGroup({
            title: 'CLI Settings',
            description: 'Configure the codexbar CLI connection',
        });
        advancedPage.add(advancedGroup);
        
        // CLI path
        const cliPathRow = new Adw.EntryRow({
            title: 'CLI Path',
        });
        cliPathRow.set_text(settings.get_string('cli-path'));
        cliPathRow.connect('changed', () => {
            settings.set_string('cli-path', cliPathRow.get_text());
        });
        advancedGroup.add(cliPathRow);
        
        const cliPathHint = new Adw.ActionRow({
            title: '',
            subtitle: 'Leave empty to auto-detect from PATH',
        });
        advancedGroup.add(cliPathHint);
        
        // CLI timeout
        const timeoutRow = new Adw.SpinRow({
            title: 'CLI Timeout',
            subtitle: 'Maximum seconds to wait for CLI response',
        });
        timeoutRow.set_adjustment(new Gtk.Adjustment({
            lower: 5,
            upper: 60,
            step_increment: 5,
            value: settings.get_int('cli-timeout'),
        }));
        timeoutRow.connect('notify::value', () => {
            settings.set_int('cli-timeout', timeoutRow.get_value());
        });
        advancedGroup.add(timeoutRow);
        
        // Stale threshold
        const staleRow = new Adw.SpinRow({
            title: 'Stale Threshold',
            subtitle: 'Seconds before data is marked as stale',
        });
        staleRow.set_adjustment(new Gtk.Adjustment({
            lower: 60,
            upper: 3600,
            step_increment: 60,
            value: settings.get_int('stale-after-seconds'),
        }));
        staleRow.connect('notify::value', () => {
            settings.set_int('stale-after-seconds', staleRow.get_value());
        });
        advancedGroup.add(staleRow);
        
        // Debug group
        const debugGroup = new Adw.PreferencesGroup({
            title: 'Debugging',
        });
        advancedPage.add(debugGroup);
        
        // Debug logging
        const debugRow = new Adw.SwitchRow({
            title: 'Debug Logging',
            subtitle: 'Log verbose debug information to journal',
        });
        settings.bind('debug-logging', debugRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        debugGroup.add(debugRow);
        
        // Clear cache button
        const clearCacheRow = new Adw.ActionRow({
            title: 'Clear Cache',
            subtitle: 'Remove cached provider data',
            activatable: true,
        });
        clearCacheRow.add_suffix(new Gtk.Image({
            icon_name: 'user-trash-symbolic',
        }));
        clearCacheRow.connect('activated', () => {
            settings.set_string('cache-last-payload', '');
            settings.set_int64('cache-last-success-ts', 0);
            settings.set_string('cache-last-error', '');
            // Show toast
            const toast = new Adw.Toast({
                title: 'Cache cleared',
                timeout: 2,
            });
            window.add_toast(toast);
        });
        debugGroup.add(clearCacheRow);
        
        // About group
        const aboutGroup = new Adw.PreferencesGroup({
            title: 'About',
        });
        advancedPage.add(aboutGroup);
        
        const versionRow = new Adw.ActionRow({
            title: 'Version',
            subtitle: '1.0',
        });
        aboutGroup.add(versionRow);
        
        const githubRow = new Adw.ActionRow({
            title: 'GitHub',
            subtitle: 'Report issues or contribute',
            activatable: true,
        });
        githubRow.add_suffix(new Gtk.Image({
            icon_name: 'web-browser-symbolic',
        }));
        githubRow.connect('activated', () => {
            try {
                Gio.AppInfo.launch_default_for_uri('https://github.com/codexbar/gnome-codexbar', null);
            } catch (e) {
                console.error(`[CodexBar] Failed to open URL: ${e.message}`);
            }
        });
        aboutGroup.add(githubRow);
    }
}
