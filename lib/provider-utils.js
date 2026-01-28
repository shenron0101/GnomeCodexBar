/**
 * provider-utils.js - Pure utility functions for provider data
 * 
 * These functions are Node-compatible and can be unit tested.
 * The GJS extension imports these, and tests use them directly.
 */

/**
 * Provider display names by ID
 */
const PROVIDER_NAMES = {
    'codex': 'Codex',
    'claude': 'Claude Code',
    'cursor': 'Cursor',
    'gemini': 'Gemini',
    'copilot': 'GitHub Copilot',
    'opencode': 'OpenCode',
    'kimi': 'Kimi',
    'kimik2': 'Kimi K2',
    'kiro': 'Kiro',
    'zai': 'z.ai',
    'factory': 'Factory/Droid',
    'augment': 'Augment',
    'amp': 'Amp',
    'antigravity': 'Antigravity',
    'jetbrains': 'JetBrains AI',
    'vertex': 'Vertex AI',
    'minimax': 'MiniMax',
    'synthetic': 'Synthetic',
};

/**
 * Format provider ID to display name
 * @param {string} id - Provider ID
 * @returns {string} Display name
 */
export function formatProviderName(id) {
    return PROVIDER_NAMES[id?.toLowerCase()] || id || 'Unknown';
}

/**
 * Try to parse JSON, return null on failure
 * @param {string} text - JSON string
 * @returns {any|null} Parsed value or null
 */
export function tryParseJSON(text) {
    if (!text || text.trim().length === 0) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Normalize a usage window from CLI format
 * @param {Object} window - Raw window data
 * @param {string} defaultLabel - Default label if none provided
 * @returns {Object} Normalized window
 */
export function normalizeWindow(window, defaultLabel) {
    if (!window) return null;
    
    return {
        label: defaultLabel,
        usedPercent: window.usedPercent ?? 0,
        remainingPercent: 100 - (window.usedPercent ?? 0),
        windowMinutes: window.windowMinutes || null,
        resetsAt: window.resetsAt || null,
        resetDescription: window.resetDescription || null,
    };
}

/**
 * Normalize provider data from CLI format to extension format
 * @param {Object} raw - Raw provider payload from CLI
 * @returns {Object} Normalized provider data
 */
export function normalizeProvider(raw) {
    if (!raw) return null;
    
    const provider = {
        id: raw.provider || 'unknown',
        name: formatProviderName(raw.provider),
        version: raw.version || null,
        source: raw.source || null,
        account: raw.account || raw.usage?.identity?.accountEmail || null,
        organization: raw.usage?.identity?.accountOrganization || null,
        plan: raw.usage?.identity?.loginMethod || null,
        status: null,
        primary: null,
        secondary: null,
        tertiary: null,
        credits: null,
        error: raw.error || null,
    };

    // Status info
    if (raw.status) {
        provider.status = {
            indicator: raw.status.indicator || 'unknown',
            description: raw.status.description || null,
            url: raw.status.url || null,
            updatedAt: raw.status.updatedAt || null,
        };
    }

    // Usage windows
    if (raw.usage) {
        if (raw.usage.primary) {
            provider.primary = normalizeWindow(raw.usage.primary, 'Session');
        }
        if (raw.usage.secondary) {
            provider.secondary = normalizeWindow(raw.usage.secondary, 'Weekly');
        }
        if (raw.usage.tertiary) {
            provider.tertiary = normalizeWindow(raw.usage.tertiary, 'Tertiary');
        }
    }

    // Credits
    if (raw.credits) {
        provider.credits = {
            remaining: raw.credits.remaining,
            updatedAt: raw.credits.updatedAt || null,
        };
    }

    return provider;
}

/**
 * Calculate aggregate stats from providers
 * @param {Array} providers - Array of normalized provider data
 * @param {Object} options - Threshold options
 * @param {number} options.warningThreshold - Percent below which is warning (default 20)
 * @param {number} options.criticalThreshold - Percent below which is critical (default 5)
 * @returns {Object} Aggregate statistics
 */
export function calculateAggregateStats(providers, options = {}) {
    const { 
        warningThreshold = 20, 
        criticalThreshold = 5 
    } = options;
    
    if (!providers || providers.length === 0) {
        return {
            minRemainingPercent: null,
            urgentProvider: null,
            warningCount: 0,
            criticalCount: 0,
            nextResetTime: null,
        };
    }

    let minPercent = 100;
    let urgentProvider = null;
    let warningCount = 0;
    let criticalCount = 0;
    let nextReset = null;

    for (const p of providers) {
        // Skip providers with errors
        if (p.error) continue;

        // Find minimum remaining percent across all windows
        const windows = [p.primary, p.secondary, p.tertiary].filter(w => w);
        for (const w of windows) {
            if (w.remainingPercent < minPercent) {
                minPercent = w.remainingPercent;
                urgentProvider = p;
            }

            // Track warning/critical counts
            if (w.remainingPercent < criticalThreshold) {
                criticalCount++;
            } else if (w.remainingPercent < warningThreshold) {
                warningCount++;
            }

            // Find nearest reset
            if (w.resetsAt) {
                const resetTime = new Date(w.resetsAt).getTime();
                if (!nextReset || resetTime < nextReset) {
                    nextReset = resetTime;
                }
            }
        }
    }

    return {
        minRemainingPercent: minPercent < 100 ? minPercent : null,
        urgentProvider,
        warningCount,
        criticalCount,
        nextResetTime: nextReset,
    };
}

/**
 * Format a duration in human-readable form
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Human-readable duration
 */
export function formatDuration(ms) {
    if (ms < 0) return 'now';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Format percentage for display
 * @param {number} percent - Percentage value
 * @param {number} decimals - Decimal places (default 0)
 * @returns {string} Formatted percentage
 */
export function formatPercent(percent, decimals = 0) {
    if (percent == null) return '--';
    return `${percent.toFixed(decimals)}%`;
}
