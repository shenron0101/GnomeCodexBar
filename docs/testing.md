# GnomeCodexBar Testing Checklist

## Prerequisites

- GNOME Shell 46+ installed
- `codexbar` CLI installed and in PATH (optional for error state testing)
- Extension installed via `make install-local`

## Installation Tests

### 1. Schema Compilation
```bash
cd ~/Desktop/Projects/GnomeCodexBar
make validate-schema
make extension
```
**Expected**: No errors, `schemas/gschemas.compiled` created

### 2. Local Installation
```bash
make install-local
```
**Expected**: Extension copied to `~/.local/share/gnome-shell/extensions/gnome-codexbar@codexbar.app/`

### 3. Enable Extension
```bash
gnome-extensions enable gnome-codexbar@codexbar.app
```
**Expected**: Extension appears in `gnome-extensions list --enabled`

### 4. Restart GNOME Shell
- X11: `Alt+F2 → r → Enter`
- Wayland: Log out and back in

**Expected**: No crash, indicator appears in panel

## Functional Tests

### 5. CLI Missing
Remove `codexbar` from PATH or set invalid path in preferences.

**Expected**:
- Indicator shows error state (exclamation icon)
- Menu shows "CLI not found" message
- No crash or freezing

### 6. Invalid JSON
Mock CLI to return malformed JSON.

**Expected**:
- Extension preserves last cached data
- Shows stale indicator if cached data exists
- Shows error if no cache

### 7. Partial Data
Test with provider returning only credits (no usage windows).

**Expected**:
- Provider row shows without progress bars
- Credits line displays correctly
- No crash

### 8. Refresh Cycle
Set 1-minute refresh interval.

**Expected**:
- Timer fires every minute
- Data updates visible in menu
- "Updated Xm ago" text changes

### 9. Manual Refresh
Click refresh button in menu.

**Expected**:
- Loading state shown briefly
- Data updates after fetch completes
- Menu closes after refresh (optional)

### 10. Provider Visibility
Toggle provider visibility in preferences.

**Expected**:
- Disabled provider hidden from menu
- Indicator still aggregates from visible providers
- Settings persist across restarts

### 11. Stale Detection
Set stale threshold to 60s, wait 2 minutes without network.

**Expected**:
- Indicator shows stale state (dashed icon)
- "Data from Xm ago" message in menu
- Click to refresh prompt

## Performance Tests

### 12. Memory Baseline
```bash
MEM_BEFORE=$(ps -o rss= -p $(pgrep gnome-shell))
gnome-extensions enable gnome-codexbar@codexbar.app
sleep 10
MEM_AFTER=$(ps -o rss= -p $(pgrep gnome-shell))
echo "Memory delta: $((MEM_AFTER - MEM_BEFORE)) KB"
```
**Expected**: < 10MB increase

### 13. CPU Idle
```bash
top -p $(pgrep gnome-shell)
```
**Expected**: < 1% CPU when extension idle

### 14. Enable/Disable Cycles
```bash
for i in {1..10}; do
  gnome-extensions disable gnome-codexbar@codexbar.app
  gnome-extensions enable gnome-codexbar@codexbar.app
  sleep 2
done
```
**Expected**: No memory leak, shell stable

## Error Recovery Tests

### 15. Extension Crash
Add `throw new Error('test')` to enable(), reinstall.

**Expected**:
- GNOME Shell continues running
- Extension shows ERROR state in extensions app
- Error logged to journal

### 16. Settings Reset
```bash
dconf reset -f /org/gnome/shell/extensions/gnome-codexbar/
gnome-extensions disable gnome-codexbar@codexbar.app
gnome-extensions enable gnome-codexbar@codexbar.app
```
**Expected**: Extension uses defaults, no crash

### 17. Preferences Window
```bash
gnome-extensions prefs gnome-codexbar@codexbar.app
```
**Expected**: Window opens, all tabs render correctly

## Logging

### View Extension Logs
```bash
journalctl -f /usr/bin/gnome-shell | grep -i codexbar
```

### Enable Debug Mode
Settings → Advanced → Enable debug logging

**Expected**: Verbose logs appear in journal

## Test Matrix

| Test | GNOME 46 | GNOME 47 | GNOME 48 | GNOME 49 |
|------|----------|----------|----------|----------|
| Install | | | | |
| Enable | | | | |
| CLI fetch | | | | |
| Menu render | | | | |
| Prefs open | | | | |
| Error states | | | | |
| Performance | | | | |

## Cleanup

```bash
make disable
make uninstall
dconf reset -f /org/gnome/shell/extensions/gnome-codexbar/
```
