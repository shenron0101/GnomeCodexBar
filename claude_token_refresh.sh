#!/usr/bin/env bash
#
# claude_token_refresh.sh - Background helper to refresh Claude tokens
#
# Usage: ./claude_token_refresh.sh {start|stop|status|once|loop}
#
#   start  - Daemonize and run refresh loop in background
#   stop   - Stop the running daemon
#   status - Check if daemon is running
#   once   - Run a single refresh immediately
#   loop   - Run refresh loop forever (foreground)
#
# Environment:
#   XDG_CONFIG_HOME - Config directory (default: ~/.config)
#   USAGE_TUI_CLAUDE_REFRESH_INTERVAL_SECONDS - Interval in seconds (default: 1800)

set -euo pipefail

# Configuration
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/usage-tui"
PID_FILE="$CONFIG_DIR/claude_token_refresh.pid"
LOG_FILE="$CONFIG_DIR/claude_token_refresh.log"
INTERVAL="${USAGE_TUI_CLAUDE_REFRESH_INTERVAL_SECONDS:-1800}"

# Ensure config directory exists
mkdir -p "$CONFIG_DIR"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Run a single refresh cycle
do_refresh() {
    log "Starting token refresh cycle"
    
    if command -v claude >/dev/null 2>&1; then
        log "Running: claude /usage"
        claude /usage >>"$LOG_FILE" 2>&1 || log "Warning: claude /usage failed"
    else
        log "Warning: claude command not found"
    fi
    
    if command -v usage-tui >/dev/null 2>&1; then
        log "Running: usage-tui login --provider claude"
        usage-tui login --provider claude >>"$LOG_FILE" 2>&1 || log "Warning: usage-tui login failed"
    else
        log "Warning: usage-tui command not found"
    fi
    
    log "Token refresh cycle complete"
}

# Run refresh loop forever
run_loop() {
    log "Starting refresh loop (interval: ${INTERVAL}s)"
    while true; do
        do_refresh
        log "Sleeping for ${INTERVAL}s"
        sleep "$INTERVAL"
    done
}

# Check if process is running
is_running() {
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null) || return 1
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Start daemon
start_daemon() {
    if is_running; then
        log "Daemon already running (PID: $(cat "$PID_FILE"))"
        return 0
    fi
    
    log "Starting daemon"
    nohup "$0" loop >>"$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" >"$PID_FILE"
    log "Daemon started (PID: $pid)"
}

# Stop daemon
stop_daemon() {
    if ! is_running; then
        log "Daemon not running"
        rm -f "$PID_FILE"
        return 0
    fi
    
    local pid
    pid=$(cat "$PID_FILE")
    log "Stopping daemon (PID: $pid)"
    
    if kill "$pid" 2>/dev/null; then
        rm -f "$PID_FILE"
        log "Daemon stopped"
    else
        log "Failed to stop daemon"
        return 1
    fi
}

# Show status
show_status() {
    if is_running; then
        echo "Daemon is running (PID: $(cat "$PID_FILE"))"
        echo "Config directory: $CONFIG_DIR"
        echo "Log file: $LOG_FILE"
        echo "Refresh interval: ${INTERVAL}s"
    else
        echo "Daemon is not running"
        echo "Config directory: $CONFIG_DIR"
        echo "Log file: $LOG_FILE"
    fi
}

# Show usage
show_usage() {
    cat <<'EOF'
Usage: ./claude_token_refresh.sh {start|stop|status|once|loop}

Commands:
  start  - Daemonize and run refresh loop in background
  stop   - Stop the running daemon
  status - Check if daemon is running
  once   - Run a single refresh immediately
  loop   - Run refresh loop forever (foreground)

Environment Variables:
  XDG_CONFIG_HOME                           Config directory (default: ~/.config)
  USAGE_TUI_CLAUDE_REFRESH_INTERVAL_SECONDS Interval in seconds (default: 1800)
EOF
}

# Main command dispatch
case "${1:-}" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    status)
        show_status
        ;;
    once)
        do_refresh
        ;;
    loop)
        run_loop
        ;;
    *)
        show_usage
        exit 1
        ;;
esac
