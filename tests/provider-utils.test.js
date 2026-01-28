/**
 * Unit tests for provider-utils.js
 */
import { describe, it, expect } from 'vitest';
import {
    formatProviderName,
    tryParseJSON,
    normalizeWindow,
    normalizeProvider,
    calculateAggregateStats,
    formatDuration,
    formatPercent,
} from '../lib/provider-utils.js';

// =============================================================================
// formatProviderName
// =============================================================================
describe('formatProviderName', () => {
    it('should return display name for known providers', () => {
        expect(formatProviderName('claude')).toBe('Claude Code');
        expect(formatProviderName('cursor')).toBe('Cursor');
        expect(formatProviderName('copilot')).toBe('GitHub Copilot');
        expect(formatProviderName('opencode')).toBe('OpenCode');
    });

    it('should be case-insensitive', () => {
        expect(formatProviderName('CLAUDE')).toBe('Claude Code');
        expect(formatProviderName('Claude')).toBe('Claude Code');
        expect(formatProviderName('CURSOR')).toBe('Cursor');
    });

    it('should return the id itself for unknown providers', () => {
        expect(formatProviderName('unknown-provider')).toBe('unknown-provider');
        expect(formatProviderName('newai')).toBe('newai');
    });

    it('should handle null/undefined', () => {
        expect(formatProviderName(null)).toBe('Unknown');
        expect(formatProviderName(undefined)).toBe('Unknown');
        expect(formatProviderName('')).toBe('Unknown');
    });
});

// =============================================================================
// tryParseJSON
// =============================================================================
describe('tryParseJSON', () => {
    it('should parse valid JSON', () => {
        expect(tryParseJSON('{"foo": "bar"}')).toEqual({ foo: 'bar' });
        expect(tryParseJSON('[1, 2, 3]')).toEqual([1, 2, 3]);
        expect(tryParseJSON('"hello"')).toBe('hello');
        expect(tryParseJSON('123')).toBe(123);
        expect(tryParseJSON('true')).toBe(true);
    });

    it('should return null for invalid JSON', () => {
        expect(tryParseJSON('{invalid}')).toBeNull();
        expect(tryParseJSON('not json')).toBeNull();
        expect(tryParseJSON('{"foo": }')).toBeNull();
    });

    it('should return null for empty/null input', () => {
        expect(tryParseJSON('')).toBeNull();
        expect(tryParseJSON('   ')).toBeNull();
        expect(tryParseJSON(null)).toBeNull();
        expect(tryParseJSON(undefined)).toBeNull();
    });
});

// =============================================================================
// normalizeWindow
// =============================================================================
describe('normalizeWindow', () => {
    it('should normalize a window with usedPercent', () => {
        const raw = { usedPercent: 30, windowMinutes: 60, resetsAt: '2024-01-01T12:00:00Z' };
        const result = normalizeWindow(raw, 'Session');
        
        expect(result.label).toBe('Session');
        expect(result.usedPercent).toBe(30);
        expect(result.remainingPercent).toBe(70);
        expect(result.windowMinutes).toBe(60);
        expect(result.resetsAt).toBe('2024-01-01T12:00:00Z');
    });

    it('should default usedPercent to 0 if missing', () => {
        const raw = {};
        const result = normalizeWindow(raw, 'Weekly');
        
        expect(result.usedPercent).toBe(0);
        expect(result.remainingPercent).toBe(100);
    });

    it('should handle null window', () => {
        expect(normalizeWindow(null, 'Test')).toBeNull();
        expect(normalizeWindow(undefined, 'Test')).toBeNull();
    });

    it('should handle missing optional fields', () => {
        const raw = { usedPercent: 50 };
        const result = normalizeWindow(raw, 'Test');
        
        expect(result.windowMinutes).toBeNull();
        expect(result.resetsAt).toBeNull();
        expect(result.resetDescription).toBeNull();
    });
});

// =============================================================================
// normalizeProvider
// =============================================================================
describe('normalizeProvider', () => {
    it('should normalize a complete provider payload', () => {
        const raw = {
            provider: 'claude',
            version: '1.0',
            source: 'api',
            account: 'test@example.com',
            status: {
                indicator: 'operational',
                description: 'All systems go',
                url: 'https://status.anthropic.com',
            },
            usage: {
                primary: { usedPercent: 25, windowMinutes: 180 },
                secondary: { usedPercent: 10, windowMinutes: 10080 },
                identity: {
                    accountEmail: 'alt@example.com',
                    accountOrganization: 'TestOrg',
                    loginMethod: 'pro',
                },
            },
            credits: {
                remaining: 100,
                updatedAt: '2024-01-01T00:00:00Z',
            },
        };

        const result = normalizeProvider(raw);

        expect(result.id).toBe('claude');
        expect(result.name).toBe('Claude Code');
        expect(result.version).toBe('1.0');
        expect(result.source).toBe('api');
        expect(result.account).toBe('test@example.com');
        expect(result.organization).toBe('TestOrg');
        expect(result.plan).toBe('pro');
        expect(result.status.indicator).toBe('operational');
        expect(result.primary.remainingPercent).toBe(75);
        expect(result.secondary.remainingPercent).toBe(90);
        expect(result.credits.remaining).toBe(100);
        expect(result.error).toBeNull();
    });

    it('should use identity email as fallback for account', () => {
        const raw = {
            provider: 'cursor',
            usage: {
                identity: { accountEmail: 'identity@example.com' },
            },
        };

        const result = normalizeProvider(raw);
        expect(result.account).toBe('identity@example.com');
    });

    it('should handle provider with error', () => {
        const raw = {
            provider: 'gemini',
            error: { message: 'Auth failed' },
        };

        const result = normalizeProvider(raw);
        expect(result.id).toBe('gemini');
        expect(result.error).toEqual({ message: 'Auth failed' });
    });

    it('should handle null input', () => {
        expect(normalizeProvider(null)).toBeNull();
        expect(normalizeProvider(undefined)).toBeNull();
    });

    it('should default to unknown for missing provider id', () => {
        const raw = {};
        const result = normalizeProvider(raw);
        expect(result.id).toBe('unknown');
        expect(result.name).toBe('Unknown');
    });
});

// =============================================================================
// calculateAggregateStats
// =============================================================================
describe('calculateAggregateStats', () => {
    it('should return empty stats for null/empty providers', () => {
        expect(calculateAggregateStats(null)).toEqual({
            minRemainingPercent: null,
            urgentProvider: null,
            warningCount: 0,
            criticalCount: 0,
            nextResetTime: null,
        });

        expect(calculateAggregateStats([])).toEqual({
            minRemainingPercent: null,
            urgentProvider: null,
            warningCount: 0,
            criticalCount: 0,
            nextResetTime: null,
        });
    });

    it('should find minimum remaining percent', () => {
        const providers = [
            { id: 'a', primary: { remainingPercent: 80 } },
            { id: 'b', primary: { remainingPercent: 30 } },
            { id: 'c', primary: { remainingPercent: 60 } },
        ];

        const result = calculateAggregateStats(providers);
        expect(result.minRemainingPercent).toBe(30);
        expect(result.urgentProvider.id).toBe('b');
    });

    it('should count warnings and criticals with default thresholds', () => {
        const providers = [
            { id: 'ok', primary: { remainingPercent: 50 } },
            { id: 'warn1', primary: { remainingPercent: 15 } },
            { id: 'warn2', primary: { remainingPercent: 10 } },
            { id: 'crit', primary: { remainingPercent: 3 } },
        ];

        const result = calculateAggregateStats(providers);
        expect(result.warningCount).toBe(2); // 15% and 10% (< 20, >= 5)
        expect(result.criticalCount).toBe(1); // 3% (< 5)
    });

    it('should respect custom thresholds', () => {
        const providers = [
            { id: 'a', primary: { remainingPercent: 25 } },
            { id: 'b', primary: { remainingPercent: 8 } },
        ];

        const result = calculateAggregateStats(providers, {
            warningThreshold: 30,
            criticalThreshold: 10,
        });

        expect(result.warningCount).toBe(1); // 25% (< 30, >= 10)
        expect(result.criticalCount).toBe(1); // 8% (< 10)
    });

    it('should skip providers with errors', () => {
        const providers = [
            { id: 'ok', primary: { remainingPercent: 50 } },
            { id: 'bad', error: { message: 'failed' }, primary: { remainingPercent: 1 } },
        ];

        const result = calculateAggregateStats(providers);
        expect(result.minRemainingPercent).toBe(50);
        expect(result.criticalCount).toBe(0);
    });

    it('should find nearest reset time', () => {
        const providers = [
            { id: 'a', primary: { remainingPercent: 50, resetsAt: '2024-06-01T12:00:00Z' } },
            { id: 'b', primary: { remainingPercent: 50, resetsAt: '2024-05-01T12:00:00Z' } },
            { id: 'c', primary: { remainingPercent: 50, resetsAt: '2024-07-01T12:00:00Z' } },
        ];

        const result = calculateAggregateStats(providers);
        expect(result.nextResetTime).toBe(new Date('2024-05-01T12:00:00Z').getTime());
    });

    it('should check all windows (primary, secondary, tertiary)', () => {
        const providers = [
            {
                id: 'multi',
                primary: { remainingPercent: 80 },
                secondary: { remainingPercent: 15 },
                tertiary: { remainingPercent: 2 },
            },
        ];

        const result = calculateAggregateStats(providers);
        expect(result.minRemainingPercent).toBe(2);
        expect(result.warningCount).toBe(1); // secondary at 15%
        expect(result.criticalCount).toBe(1); // tertiary at 2%
    });
});

// =============================================================================
// formatDuration
// =============================================================================
describe('formatDuration', () => {
    it('should format seconds', () => {
        expect(formatDuration(5000)).toBe('5s');
        expect(formatDuration(45000)).toBe('45s');
    });

    it('should format minutes', () => {
        expect(formatDuration(60 * 1000)).toBe('1m');
        expect(formatDuration(5 * 60 * 1000)).toBe('5m');
        expect(formatDuration(45 * 60 * 1000)).toBe('45m');
    });

    it('should format hours and minutes', () => {
        expect(formatDuration(60 * 60 * 1000)).toBe('1h 0m');
        expect(formatDuration(2.5 * 60 * 60 * 1000)).toBe('2h 30m');
    });

    it('should format days and hours', () => {
        expect(formatDuration(24 * 60 * 60 * 1000)).toBe('1d 0h');
        expect(formatDuration(36 * 60 * 60 * 1000)).toBe('1d 12h');
    });

    it('should return "now" for negative values', () => {
        expect(formatDuration(-1000)).toBe('now');
    });
});

// =============================================================================
// formatPercent
// =============================================================================
describe('formatPercent', () => {
    it('should format percentage with default decimals', () => {
        expect(formatPercent(75)).toBe('75%');
        expect(formatPercent(100)).toBe('100%');
        expect(formatPercent(0)).toBe('0%');
    });

    it('should format with specified decimals', () => {
        expect(formatPercent(75.567, 1)).toBe('75.6%');
        expect(formatPercent(75.567, 2)).toBe('75.57%');
    });

    it('should return "--" for null/undefined', () => {
        expect(formatPercent(null)).toBe('--');
        expect(formatPercent(undefined)).toBe('--');
    });
});
