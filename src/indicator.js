/**
 * indicator.js - Panel indicator with meter icon
 * 
 * Displays a combined meter icon in the GNOME Shell top bar
 * with badge overlay for warning counts.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { CodexBarMenu } from './menu.js';

// Icon dimensions
const ICON_SIZE = 18;
const BAR_WIDTH = 12;
const BAR_HEIGHT = 3;
const BAR_X = 3;
const TOP_BAR_Y = 4;
const BOTTOM_BAR_Y = 11;
const CORNER_RADIUS = 1.5;

// Colors (RGBA)
const COLORS = {
    normal: [1, 1, 1, 0.9],
    warning: [0.965, 0.827, 0.176, 0.95],   // #f6d32d
    critical: [0.965, 0.38, 0.318, 0.95],    // #f66151
    stale: [1, 1, 1, 0.35],
    error: [0.965, 0.38, 0.318, 0.95],
    empty: [1, 1, 1, 0.15],
    loading: [1, 1, 1, 0.5],
};

export const CodexBarIndicator = GObject.registerClass(
class CodexBarIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'CodexBar', false);
        
        this._extension = extension;
        this._state = null;
        this._percentage = null;
        this._badgeCount = 0;
        
        // Create container
        this._box = new St.BoxLayout({
            style_class: 'codexbar-indicator',
        });
        this.add_child(this._box);
        
        // Create icon using DrawingArea (Clutter.Canvas replacement for GNOME 46+)
        this._canvas = new St.DrawingArea({
            width: ICON_SIZE,
            height: ICON_SIZE,
        });
        this._canvas.connect('repaint', this._onRepaint.bind(this));
        this._box.add_child(this._canvas);
        
        // Optional text label
        this._label = new St.Label({
            style_class: 'codexbar-label',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._box.add_child(this._label);
        
        // Badge overlay
        this._badge = new St.Label({
            style_class: 'codexbar-badge',
            visible: false,
        });
        this._box.add_child(this._badge);
        
        // Create popup menu
        this._menuManager = new CodexBarMenu(this, extension);
        
        // Connect menu open signal for refresh-on-open
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open && extension.settings?.get_boolean('refresh-on-open')) {
                extension.manualRefresh();
            }
            if (open) {
                this._menuManager.rebuildMenu();
            }
        });
        
        // Set initial tooltip
        this._updateTooltip();
    }

    /**
     * Update indicator state
     */
    updateState(data) {
        const {
            state,
            visualState,
            percentage,
            warningCount,
            criticalCount,
            providers,
            timestamp,
            error,
            nextReset,
        } = data;
        
        this._state = visualState;
        this._percentage = percentage;
        this._badgeCount = warningCount + criticalCount;
        this._providers = providers;
        this._timestamp = timestamp;
        this._error = error;
        this._nextReset = nextReset;
        
        // Update icon
        this._canvas.queue_repaint();
        
        // Update label visibility and text
        const showText = this._extension.settings?.get_boolean('show-text');
        if (showText && percentage !== null) {
            this._label.text = `${Math.round(percentage)}%`;
            this._label.visible = true;
        } else {
            this._label.visible = false;
        }
        
        // Update label style class
        this._label.style_class = `codexbar-label codexbar-${visualState}`;
        
        // Update badge
        const showBadge = this._extension.settings?.get_boolean('show-badge');
        if (showBadge && this._badgeCount > 0) {
            this._badge.text = this._badgeCount.toString();
            this._badge.visible = true;
            this._badge.style_class = criticalCount > 0 
                ? 'codexbar-badge codexbar-critical'
                : 'codexbar-badge codexbar-warning';
        } else {
            this._badge.visible = false;
        }
        
        // Update indicator style class
        this._box.style_class = `codexbar-indicator codexbar-${visualState}`;
        
        // Update tooltip
        this._updateTooltip();
        
        // Update menu if open
        if (this.menu.isOpen) {
            this._menuManager.rebuildMenu();
        }
    }

    /**
     * Repaint the icon canvas
     */
    _onRepaint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        
        // Clear canvas
        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();
        
        // Get color based on state
        const colorKey = this._state || 'normal';
        const fillColor = COLORS[colorKey] || COLORS.normal;
        const emptyColor = COLORS.empty;
        
        // Calculate fill levels
        let topFill = 0;
        let bottomFill = 0;
        
        if (this._state !== 'stale' && this._state !== 'error' && this._percentage !== null) {
            // Top bar: represents 50-100%
            // Bottom bar: represents 0-50%
            if (this._percentage >= 50) {
                topFill = 1.0;
                bottomFill = (this._percentage - 50) / 50;
            } else {
                topFill = this._percentage / 50;
                bottomFill = 0;
            }
        }
        
        // Draw top bar
        this._drawBar(cr, BAR_X, TOP_BAR_Y, topFill, fillColor, emptyColor);
        
        // Draw bottom bar (hairline)
        this._drawBar(cr, BAR_X, BOTTOM_BAR_Y, bottomFill, fillColor, emptyColor);
        
        // Draw stale overlay (dashed lines)
        if (this._state === 'stale') {
            this._drawStaleOverlay(cr, fillColor);
        }
        
        // Draw error overlay
        if (this._state === 'error') {
            this._drawErrorOverlay(cr, fillColor);
        }
        
        cr.$dispose();
    }

    /**
     * Draw a progress bar
     */
    _drawBar(cr, x, y, fillRatio, fillColor, emptyColor) {
        // Draw empty background
        cr.setSourceRGBA(...emptyColor);
        this._roundRect(cr, x, y, BAR_WIDTH, BAR_HEIGHT, CORNER_RADIUS);
        cr.fill();
        
        // Draw filled portion
        if (fillRatio > 0) {
            const fillWidth = BAR_WIDTH * fillRatio;
            cr.setSourceRGBA(...fillColor);
            this._roundRect(cr, x, y, fillWidth, BAR_HEIGHT, CORNER_RADIUS);
            cr.fill();
        }
    }

    /**
     * Draw rounded rectangle path
     */
    _roundRect(cr, x, y, width, height, radius) {
        cr.newPath();
        cr.moveTo(x + radius, y);
        cr.lineTo(x + width - radius, y);
        cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
        cr.lineTo(x + width, y + height - radius);
        cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
        cr.lineTo(x + radius, y + height);
        cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
        cr.lineTo(x, y + radius);
        cr.arc(x + radius, y + radius, radius, Math.PI, 3 * Math.PI / 2);
        cr.closePath();
    }

    /**
     * Draw stale state overlay (dashed outline)
     */
    _drawStaleOverlay(cr, color) {
        cr.setSourceRGBA(...color);
        cr.setLineWidth(1);
        cr.setDash([2, 2], 0);
        
        this._roundRect(cr, BAR_X, TOP_BAR_Y, BAR_WIDTH, BAR_HEIGHT, CORNER_RADIUS);
        cr.stroke();
        
        this._roundRect(cr, BAR_X, BOTTOM_BAR_Y, BAR_WIDTH, BAR_HEIGHT, CORNER_RADIUS);
        cr.stroke();
        
        cr.setDash([], 0);
    }

    /**
     * Draw error state overlay
     */
    _drawErrorOverlay(cr, color) {
        // Draw exclamation mark
        cr.setSourceRGBA(...color);
        cr.setLineWidth(2);
        
        // Vertical line
        cr.moveTo(ICON_SIZE / 2, 4);
        cr.lineTo(ICON_SIZE / 2, 10);
        cr.stroke();
        
        // Dot
        cr.arc(ICON_SIZE / 2, 13, 1, 0, 2 * Math.PI);
        cr.fill();
    }

    /**
     * Update tooltip text
     */
    _updateTooltip() {
        let tooltip = 'CodexBar';
        
        if (this._providers && this._providers.length > 0) {
            tooltip = `CodexBar — ${this._providers.length} provider${this._providers.length > 1 ? 's' : ''}`;
            
            if (this._nextReset) {
                const resetTime = this._formatResetTime(this._nextReset);
                tooltip += `, next reset ${resetTime}`;
            }
        } else if (this._error) {
            tooltip = `CodexBar — Error: ${this._error}`;
        } else if (this._state === 'stale') {
            tooltip = 'CodexBar — Data is stale, click to refresh';
        }
        
        // In GNOME Shell, we set accessible-name for screen readers
        // and use the menu header for visual tooltip
        this.accessible_name = tooltip;
    }

    /**
     * Format reset time for tooltip
     */
    _formatResetTime(timestamp) {
        const now = Date.now();
        const diff = timestamp - now;
        
        if (diff < 0) return 'soon';
        
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `in ${days}d ${hours % 24}h`;
        }
        if (hours > 0) {
            return `in ${hours}h ${minutes}m`;
        }
        return `in ${minutes}m`;
    }

    /**
     * Destroy the indicator
     */
    destroy() {
        if (this._menuManager) {
            this._menuManager.destroy();
            this._menuManager = null;
        }
        super.destroy();
    }
});
