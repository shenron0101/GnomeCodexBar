#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="gnome-codexbar@codexbar.app"
ZIP_NAME="${UUID}.zip"
LOG_DIR="$ROOT_DIR/.logs"
LOG_FILE_DEFAULT="$LOG_DIR/nested-gnome-shell.log"

RUN_BUILD=1
RUN_INSTALL=1
AUTO_ENABLE=1
TAIL_LOGS=1
VERBOSE=0
LOG_FILE=""
FILTER_LOGS=1

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
  cat <<'EOF'
Usage: scripts/dev-loop.sh [options]

Development loop for GNOME CodexBar extension.
Builds, installs, and launches a nested GNOME Shell session for testing.

Options:
  --no-build       Skip zip build
  --no-install     Skip installing the zip
  --no-enable      Do not auto-enable the extension
  --no-tail        Do not tail GNOME Shell logs
  --no-filter      Show all logs (not just extension-related)
  --verbose        Enable verbose GNOME Shell logging (G_MESSAGES_DEBUG=all)
  --log-file PATH  Write GNOME Shell logs to PATH
  -h, --help       Show this help message

Keyboard shortcuts in nested session:
  Super          Open activities
  Alt+F2         Run command dialog (type 'lg' for Looking Glass debugger)
  Ctrl+C         Exit nested session (from terminal)

Log filtering:
  By default, only shows lines containing: codexbar, error, warning, gjs
  Use --no-filter to see all GNOME Shell output.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)
      RUN_BUILD=0
      ;;
    --no-install)
      RUN_INSTALL=0
      ;;
    --no-enable)
      AUTO_ENABLE=0
      ;;
    --no-tail)
      TAIL_LOGS=0
      ;;
    --no-filter)
      FILTER_LOGS=0
      ;;
    --verbose)
      VERBOSE=1
      ;;
    --log-file)
      LOG_FILE="${2:-}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

cd "$ROOT_DIR"

mkdir -p "$LOG_DIR"
if [[ -z "$LOG_FILE" ]]; then
  LOG_FILE="$LOG_FILE_DEFAULT"
fi
: > "$LOG_FILE"  # Truncate log file

echo -e "${BLUE}=== GNOME CodexBar Development Loop ===${NC}"
echo ""

# Run unit tests first
echo -e "${BLUE}[1/4] Running unit tests...${NC}"
if npm test 2>&1; then
  echo -e "${GREEN}Tests passed!${NC}"
else
  echo -e "${RED}Tests failed! Fix tests before continuing.${NC}"
  exit 1
fi
echo ""

if [[ "$RUN_BUILD" -eq 1 ]]; then
  echo -e "${BLUE}[2/4] Building extension zip...${NC}"
  make zip-file
  echo -e "${GREEN}Build complete.${NC}"
else
  echo -e "${YELLOW}[2/4] Skipping build (--no-build)${NC}"
fi
echo ""

if [[ "$RUN_INSTALL" -eq 1 ]]; then
  echo -e "${BLUE}[3/4] Installing extension...${NC}"
  gnome-extensions install --force "$ZIP_NAME"
  echo -e "${GREEN}Installed to ~/.local/share/gnome-shell/extensions/${NC}"
else
  echo -e "${YELLOW}[3/4] Skipping install (--no-install)${NC}"
fi
echo ""

echo -e "${BLUE}[4/4] Launching nested GNOME Shell (Wayland)...${NC}"
echo -e "Log file: ${YELLOW}$LOG_FILE${NC}"
echo ""
echo -e "${YELLOW}Tips:${NC}"
echo "  - Alt+F2 -> 'lg' opens Looking Glass (JS debugger)"
echo "  - Check the top bar for the CodexBar indicator"
echo "  - Ctrl+C here to exit the nested session"
echo ""

export GJS_DEBUG_OUTPUT=stderr
export GJS_DEBUG_TOPICS="JS ERROR;JS LOG"
if [[ "$VERBOSE" -eq 1 ]]; then
  export G_MESSAGES_DEBUG=all
fi

export CODEXBAR_UUID="$UUID"
export CODEXBAR_LOG_FILE="$LOG_FILE"
export CODEXBAR_AUTO_ENABLE="$AUTO_ENABLE"
export CODEXBAR_TAIL_LOGS="$TAIL_LOGS"
export CODEXBAR_FILTER_LOGS="$FILTER_LOGS"

dbus-run-session bash -c '
set -euo pipefail

RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
BLUE="\033[0;34m"
NC="\033[0m"

# Start nested GNOME Shell
gnome-shell --nested --wayland >"$CODEXBAR_LOG_FILE" 2>&1 &
shell_pid=$!

cleanup() {
  echo ""
  echo -e "${BLUE}Shutting down...${NC}"
  kill "$shell_pid" 2>/dev/null || true
  if [[ -n "${tail_pid:-}" ]]; then
    kill "$tail_pid" 2>/dev/null || true
  fi
  
  # Show summary of errors
  echo ""
  echo -e "${BLUE}=== Error Summary ===${NC}"
  error_count=$(grep -ciE "(error|exception|gjs.*error)" "$CODEXBAR_LOG_FILE" 2>/dev/null || echo "0")
  if [[ "$error_count" -gt 0 ]]; then
    echo -e "${RED}Found $error_count error-related lines in log.${NC}"
    echo "Review: $CODEXBAR_LOG_FILE"
    echo ""
    echo "Last 10 errors:"
    grep -iE "(error|exception)" "$CODEXBAR_LOG_FILE" | tail -10 || true
  else
    echo -e "${GREEN}No errors found in log.${NC}"
  fi
  exit 0
}
trap cleanup EXIT INT TERM

# Start log tailing
if [[ "$CODEXBAR_TAIL_LOGS" -eq 1 ]]; then
  sleep 1  # Let shell start writing logs
  if [[ "$CODEXBAR_FILTER_LOGS" -eq 1 ]]; then
    # Filter to extension-related messages
    tail -n 50 -f "$CODEXBAR_LOG_FILE" 2>/dev/null | \
      grep --line-buffered -iE "(codexbar|error|warning|gjs|exception|critical)" &
  else
    tail -n 50 -f "$CODEXBAR_LOG_FILE" &
  fi
  tail_pid=$!
fi

# Wait for D-Bus to be ready and auto-enable
if [[ "$CODEXBAR_AUTO_ENABLE" -eq 1 ]]; then
  echo -e "${YELLOW}Waiting for GNOME Shell D-Bus...${NC}"
  ready=0
  for i in {1..300}; do
    if gdbus call --session \
      --dest org.gnome.Shell.Extensions \
      --object-path /org/gnome/Shell/Extensions \
      --method org.gnome.Shell.Extensions.ListExtensions \
      >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.1
  done

  if [[ "$ready" -eq 1 ]]; then
    sleep 1  # Extra delay for stability
    echo -e "${GREEN}D-Bus ready.${NC}"
    echo -e "${YELLOW}Enabling extension: $CODEXBAR_UUID${NC}"
    
    if gnome-extensions enable "$CODEXBAR_UUID" 2>&1; then
      echo -e "${GREEN}Extension enabled!${NC}"
    else
      echo -e "${RED}Failed to enable extension.${NC}"
    fi
    
    # Show extension info
    echo ""
    echo -e "${BLUE}=== Extension State ===${NC}"
    gnome-extensions info "$CODEXBAR_UUID" 2>&1 || echo "(info not available)"
    
    # Check if extension has errors via D-Bus
    ext_info=$(gdbus call --session \
      --dest org.gnome.Shell.Extensions \
      --object-path /org/gnome/Shell/Extensions \
      --method org.gnome.Shell.Extensions.GetExtensionInfo \
      "$CODEXBAR_UUID" 2>&1 || echo "")
    
    if echo "$ext_info" | grep -q "state.*<uint32 6>"; then
      echo -e "${RED}Extension state: ERROR${NC}"
      echo "Check the logs above for details."
    elif echo "$ext_info" | grep -q "state.*<uint32 1>"; then
      echo -e "${GREEN}Extension state: ENABLED${NC}"
    elif echo "$ext_info" | grep -q "state.*<uint32 2>"; then
      echo -e "${YELLOW}Extension state: DISABLED${NC}"
    fi
    echo ""
  else
    echo -e "${RED}GNOME Shell D-Bus did not become ready after 30s.${NC}"
    echo "The nested session may have crashed. Check: $CODEXBAR_LOG_FILE"
  fi
fi

echo -e "${BLUE}Nested session running. Press Ctrl+C to exit.${NC}"
echo ""

# Wait for shell to exit
wait "$shell_pid"
'
