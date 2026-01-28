/**
 * cli.js - CodexBar CLI wrapper with async subprocess
 * 
 * Spawns `codexbar --format json` and parses the output.
 * Handles timeouts, errors, and caching.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Import pure utility functions from shared library
import { 
    normalizeProvider, 
    tryParseJSON, 
    calculateAggregateStats,
    formatProviderName,
    formatDuration,
    formatPercent,
} from './lib/provider-utils.js';

// Re-export for use by other modules
export { 
    calculateAggregateStats, 
    formatProviderName, 
    formatDuration, 
    formatPercent 
};

// Promisify async methods
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

/**
 * Result from CLI execution
 * @typedef {Object} CLIResult
 * @property {boolean} success - Whether the CLI call succeeded
 * @property {Array|null} providers - Parsed provider data
 * @property {string|null} error - Error message if failed
 * @property {number} timestamp - Unix timestamp of fetch
 */

/**
 * Find the codexbar CLI binary
 * @param {string} customPath - User-specified path (empty = auto-detect)
 * @returns {string|null} Path to codexbar binary or null if not found
 */
export function findCLI(customPath = '') {
    if (customPath && customPath.length > 0) {
        // User specified a path
        if (GLib.file_test(customPath, GLib.FileTest.IS_EXECUTABLE)) {
            return customPath;
        }
        return null;
    }
    
    // Auto-detect from PATH
    const result = GLib.find_program_in_path('codexbar');
    return result;
}

/**
 * Execute codexbar CLI and return parsed results
 * @param {Object} options - Execution options
 * @param {string} options.cliPath - Path to CLI (empty = auto-detect)
 * @param {number} options.timeout - Timeout in seconds (default: 10)
 * @param {boolean} options.debug - Enable debug logging
 * @returns {Promise<CLIResult>}
 */
export async function fetchProviders(options = {}) {
    const {
        cliPath = '',
        timeout = 10,
        debug = false,
    } = options;

    const timestamp = Math.floor(Date.now() / 1000);
    
    // Find CLI binary
    const binary = findCLI(cliPath);
    if (!binary) {
        return {
            success: false,
            providers: null,
            error: 'codexbar CLI not found. Install from https://codexbar.app or set CLI path in preferences.',
            timestamp,
        };
    }

    if (debug) {
        log(`[CodexBar] Using CLI: ${binary}`);
    }

    try {
        // Build command
        const argv = [binary, '--format', 'json', '--pretty'];
        
        // Create subprocess
        const proc = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);

        // Create cancellable for timeout
        const cancellable = new Gio.Cancellable();
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeout, () => {
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });

        // Wait for completion
        let stdout, stderr;
        try {
            [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
        } catch (e) {
            GLib.source_remove(timeoutId);
            if (cancellable.is_cancelled()) {
                return {
                    success: false,
                    providers: null,
                    error: `CLI timed out after ${timeout}s`,
                    timestamp,
                };
            }
            throw e;
        }

        GLib.source_remove(timeoutId);

        // Check exit status
        const exitStatus = proc.get_exit_status();
        if (exitStatus !== 0) {
            if (debug) {
                log(`[CodexBar] CLI exit code: ${exitStatus}, stderr: ${stderr}`);
            }
            
            // Try to parse JSON error from stdout/stderr
            const errorPayload = tryParseJSON(stdout) || tryParseJSON(stderr);
            if (errorPayload && Array.isArray(errorPayload)) {
                // CLI returns array with error objects
                const cliError = errorPayload.find(p => p.error);
                if (cliError) {
                    return {
                        success: false,
                        providers: null,
                        error: cliError.error.message || `CLI failed with exit code ${exitStatus}`,
                        timestamp,
                    };
                }
            }
            
            return {
                success: false,
                providers: null,
                error: stderr?.trim() || `CLI failed with exit code ${exitStatus}`,
                timestamp,
            };
        }

        // Parse JSON output
        const data = tryParseJSON(stdout);
        if (!data) {
            return {
                success: false,
                providers: null,
                error: 'Failed to parse CLI JSON output',
                timestamp,
            };
        }

        // CLI returns an array of provider payloads
        if (!Array.isArray(data)) {
            return {
                success: false,
                providers: null,
                error: 'CLI returned unexpected format (expected array)',
                timestamp,
            };
        }

        // Transform and validate provider data using shared normalizer
        const providers = data
            .filter(p => p.provider !== 'cli') // Filter out CLI meta entries
            .map(p => normalizeProvider(p));

        if (debug) {
            log(`[CodexBar] Fetched ${providers.length} providers`);
        }

        return {
            success: true,
            providers,
            error: null,
            timestamp,
        };

    } catch (e) {
        if (debug) {
            log(`[CodexBar] CLI error: ${e.message}`);
        }
        return {
            success: false,
            providers: null,
            error: e.message,
            timestamp,
        };
    }
}
