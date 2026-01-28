/**
 * extension.js - Main entry point for GNOME CodexBar Extension
 * 
 * Handles lifecycle (enable/disable), settings management,
 * refresh timer, and coordinates indicator + menu updates.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { CodexBarIndicator } from './indicator.js';
import { fetchProviders, calculateAggregateStats } from './cli.js';

/**
 * Extension state enum
 */
const State = {
    IDLE: 'idle',
    LOADING: 'loading',
    OK: 'ok',
    STALE: 'stale',
    ERROR: 'error',
    ERROR_WITH_CACHE: 'error_with_cache',
};

export default class CodexBarExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._settings = null;
        this._refreshTimerId = null;
        this._state = State.IDLE;
        this._cache = {
            providers: null,
            timestamp: 0,
            error: null,
        };
        this._settingsChangedId = null;
    }

    enable() {
        this._log('Enabling CodexBar extension');
        
        // Load settings
        this._settings = this.getSettings();
        
        // Load cached data from settings
        this._loadCache();
        
        // Create indicator
        this._indicator = new CodexBarIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        
        // Connect settings changed signals
        this._settingsChangedId = this._settings.connect('changed', 
            this._onSettingsChanged.bind(this));
        
        // Initial render with cached data
        this._updateUI();
        
        // Start refresh timer
        this._scheduleRefresh();
        
        // Kick off initial fetch
        this._refresh();
    }

    disable() {
        this._log('Disabling CodexBar extension');
        
        // Stop refresh timer
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = null;
        }
        
        // Disconnect settings signals
        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        
        // Destroy indicator
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        
        this._settings = null;
        this._state = State.IDLE;
    }

    /**
     * Get current state
     */
    get state() {
        return this._state;
    }

    /**
     * Get cached providers
     */
    get providers() {
        return this._cache.providers;
    }

    /**
     * Get cache timestamp
     */
    get cacheTimestamp() {
        return this._cache.timestamp;
    }

    /**
     * Get last error
     */
    get lastError() {
        return this._cache.error;
    }

    /**
     * Get settings
     */
    get settings() {
        return this._settings;
    }

    /**
     * Trigger manual refresh
     */
    async manualRefresh() {
        this._log('Manual refresh triggered');
        await this._refresh();
    }

    /**
     * Load cache from GSettings
     */
    _loadCache() {
        try {
            const payloadStr = this._settings.get_string('cache-last-payload');
            const timestamp = this._settings.get_int64('cache-last-success-ts');
            const error = this._settings.get_string('cache-last-error');
            
            if (payloadStr && payloadStr.length > 0) {
                this._cache.providers = JSON.parse(payloadStr);
                this._cache.timestamp = timestamp;
            }
            
            if (error && error.length > 0) {
                this._cache.error = error;
            }
            
            // Determine initial state based on cache
            if (this._cache.providers) {
                const staleAfter = this._settings.get_int('stale-after-seconds');
                const now = Math.floor(Date.now() / 1000);
                const age = now - this._cache.timestamp;
                
                if (age > staleAfter) {
                    this._state = State.STALE;
                } else {
                    this._state = State.OK;
                }
            } else if (this._cache.error) {
                this._state = State.ERROR;
            }
            
        } catch (e) {
            this._log(`Failed to load cache: ${e.message}`);
        }
    }

    /**
     * Save cache to GSettings
     */
    _saveCache() {
        try {
            if (this._cache.providers) {
                this._settings.set_string('cache-last-payload', 
                    JSON.stringify(this._cache.providers));
                this._settings.set_int64('cache-last-success-ts', 
                    this._cache.timestamp);
            }
            
            this._settings.set_string('cache-last-error', 
                this._cache.error || '');
                
        } catch (e) {
            this._log(`Failed to save cache: ${e.message}`);
        }
    }

    /**
     * Schedule next refresh
     */
    _scheduleRefresh() {
        // Clear existing timer
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = null;
        }
        
        const interval = this._settings.get_int('refresh-interval');
        this._refreshTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    /**
     * Perform refresh
     */
    async _refresh() {
        if (this._state === State.LOADING) {
            this._log('Refresh already in progress, skipping');
            return;
        }
        
        const previousState = this._state;
        this._state = State.LOADING;
        this._updateUI();
        
        const debug = this._settings.get_boolean('debug-logging');
        const cliPath = this._settings.get_string('cli-path');
        const timeout = this._settings.get_int('cli-timeout');
        
        const result = await fetchProviders({ cliPath, timeout, debug });
        
        if (result.success) {
            // Success - update cache
            this._cache.providers = result.providers;
            this._cache.timestamp = result.timestamp;
            this._cache.error = null;
            this._state = State.OK;
            
            this._saveCache();
            
            if (debug) {
                this._log(`Fetched ${result.providers.length} providers`);
            }
        } else {
            // Failure
            this._cache.error = result.error;
            
            if (this._cache.providers) {
                // Have cached data - show stale
                this._state = State.ERROR_WITH_CACHE;
            } else {
                // No cached data - show error
                this._state = State.ERROR;
            }
            
            this._saveCache();
            
            if (debug) {
                this._log(`Fetch failed: ${result.error}`);
            }
        }
        
        this._updateUI();
    }

    /**
     * Update UI with current state
     */
    _updateUI() {
        if (!this._indicator) return;
        
        const stats = calculateAggregateStats(this._cache.providers);
        const staleAfter = this._settings.get_int('stale-after-seconds');
        const now = Math.floor(Date.now() / 1000);
        const age = this._cache.timestamp > 0 ? now - this._cache.timestamp : 0;
        
        // Check if data is stale
        if (this._state === State.OK && age > staleAfter) {
            this._state = State.STALE;
        }
        
        // Determine visual state
        let visualState = 'normal';
        if (this._state === State.ERROR || this._state === State.ERROR_WITH_CACHE) {
            visualState = 'error';
        } else if (this._state === State.STALE) {
            visualState = 'stale';
        } else if (this._state === State.LOADING) {
            visualState = 'loading';
        } else if (stats.criticalCount > 0) {
            visualState = 'critical';
        } else if (stats.warningCount > 0) {
            visualState = 'warning';
        }
        
        // Update indicator
        this._indicator.updateState({
            state: this._state,
            visualState,
            percentage: stats.minRemainingPercent,
            warningCount: stats.warningCount,
            criticalCount: stats.criticalCount,
            providers: this._cache.providers,
            timestamp: this._cache.timestamp,
            error: this._cache.error,
            nextReset: stats.nextResetTime,
        });
    }

    /**
     * Handle settings changes
     */
    _onSettingsChanged(settings, key) {
        switch (key) {
            case 'refresh-interval':
                this._scheduleRefresh();
                break;
            case 'show-text':
            case 'show-badge':
            case 'sort-mode':
            case 'reset-display-mode':
            case 'warning-threshold':
            case 'critical-threshold':
            case 'provider-visibility':
                this._updateUI();
                break;
            case 'cli-path':
            case 'cli-timeout':
                // These will take effect on next refresh
                break;
        }
    }

    /**
     * Log helper
     */
    _log(message) {
        if (this._settings?.get_boolean('debug-logging')) {
            console.log(`[CodexBar] ${message}`);
        }
    }
}
