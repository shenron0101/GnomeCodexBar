#!/bin/bash
# Development script for usage-tui GNOME Extension

EXT_UUID="usage-tui@gnome.codexbar"

case "$1" in
    start)
        echo "Starting nested GNOME Shell..."
        dbus-run-session -- gnome-shell --nested --wayland
        ;;
    enable)
        gnome-extensions enable "$EXT_UUID"
        echo "Extension enabled"
        ;;
    disable)
        gnome-extensions disable "$EXT_UUID"
        echo "Extension disabled"
        ;;
    reload)
        gnome-extensions disable "$EXT_UUID"
        sleep 1
        gnome-extensions enable "$EXT_UUID"
        echo "Extension reloaded"
        ;;
    logs)
        journalctl -f -o cat /usr/bin/gnome-shell | grep -i "usage-tui"
        ;;
    *)
        echo "Usage: $0 {start|enable|disable|reload|logs}"
        exit 1
        ;;
esac
