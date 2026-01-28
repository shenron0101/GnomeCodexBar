# GNOME CodexBar Extension Makefile
# Modeled on dash-to-panel packaging workflow

# ============================================================================
# Configuration
# ============================================================================
UUID = gnome-codexbar@codexbar.app
EXTENSION_NAME = gnome-codexbar

# Source files
SOURCES = src/extension.js src/indicator.js src/menu.js src/cli.js src/prefs.js src/stylesheet.css
EXTRA_FILES = metadata.json
SCHEMA_FILE = schemas/org.gnome.shell.extensions.gnome-codexbar.gschema.xml

# Installation paths
ifeq ($(strip $(DESTDIR)),)
	INSTALLTYPE = local
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLTYPE = system
	INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
	SHARE_PREFIX = $(DESTDIR)/usr/share
endif

# Version handling - only set FILESUFFIX and update metadata when VERSION is explicitly provided
ifdef VERSION
	FILESUFFIX = _v$(VERSION)
	UPDATE_VERSION = 1
else
	FILESUFFIX =
	UPDATE_VERSION =
endif
COMMIT = $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# ============================================================================
# Main Targets
# ============================================================================
.PHONY: all clean extension install install-local uninstall zip-file \
        validate-schema enable disable logs prefs info help check-deps dev-loop test

all: extension

extension: schemas/gschemas.compiled
	@echo "Extension built successfully"

clean:
	rm -rf _build
	rm -f schemas/gschemas.compiled
	rm -f $(UUID)*.zip
	@echo "Cleaned build artifacts"

# ============================================================================
# Schema Compilation
# ============================================================================
schemas/gschemas.compiled: $(SCHEMA_FILE)
	@echo "Compiling GSettings schemas..."
	glib-compile-schemas schemas/

validate-schema:
	@echo "Validating schema XML..."
	xmllint --noout $(SCHEMA_FILE) 2>/dev/null || echo "xmllint not found, skipping XML validation"
	glib-compile-schemas --strict --dry-run schemas/

# ============================================================================
# Build
# ============================================================================
_build: extension
	@rm -rf _build
	@mkdir -p _build/schemas _build/lib
	@echo "Copying source files..."
	@cp metadata.json _build/
	@cp src/*.js _build/
	@cp src/*.css _build/
	@cp lib/*.js _build/lib/
	@cp schemas/*.xml _build/schemas/
	@cp schemas/gschemas.compiled _build/schemas/
	@# Copy docs if they exist
	@if [ -d "docs" ]; then mkdir -p _build/docs && cp -r docs/* _build/docs/; fi
ifdef UPDATE_VERSION
	@sed -i 's/"version": *[0-9]*/"version": $(VERSION)/' _build/metadata.json
endif
	@echo "Build complete in _build/"

# ============================================================================
# Installation
# ============================================================================
install: install-local

install-local: _build
	@echo "Installing to $(INSTALLBASE)/$(UUID)..."
	@rm -rf "$(INSTALLBASE)/$(UUID)"
	@mkdir -p "$(INSTALLBASE)/$(UUID)"
	@cp -r _build/* "$(INSTALLBASE)/$(UUID)/"
ifeq ($(INSTALLTYPE),system)
	@rm -rf "$(INSTALLBASE)/$(UUID)/schemas"
	@mkdir -p $(SHARE_PREFIX)/glib-2.0/schemas
	@cp schemas/*.xml $(SHARE_PREFIX)/glib-2.0/schemas/
	@glib-compile-schemas $(SHARE_PREFIX)/glib-2.0/schemas/
endif
	@rm -rf _build
	@echo ""
	@echo "Installation complete!"
	@echo "To enable: gnome-extensions enable $(UUID)"
	@echo "Then restart GNOME Shell (Alt+F2 → r on X11, or log out/in on Wayland)"

uninstall:
	@echo "Removing $(INSTALLBASE)/$(UUID)..."
	@rm -rf "$(INSTALLBASE)/$(UUID)"
	@echo "Uninstall complete."

# ============================================================================
# Packaging
# ============================================================================
zip-file: _build
	@echo "Creating zip package..."
	@cd _build && zip -qr "../$(UUID)$(FILESUFFIX).zip" .
	@rm -rf _build
	@echo "Created $(UUID)$(FILESUFFIX).zip"

dist: clean zip-file

# ============================================================================
# Development Helpers
# ============================================================================
enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

restart-shell:
	@echo "Restarting GNOME Shell..."
	@if [ "$$XDG_SESSION_TYPE" = "x11" ]; then \
		busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting...")' 2>/dev/null || \
		echo "Could not restart shell via D-Bus"; \
	else \
		echo "On Wayland: Log out and back in to restart GNOME Shell"; \
	fi

logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep -iE "codexbar|error|warning" || journalctl -f -o cat /usr/bin/gnome-shell

prefs:
	gnome-extensions prefs $(UUID)

info:
	gnome-extensions info $(UUID)

dev-loop:
	@./scripts/dev-loop.sh

test:
	@npm test

test-watch:
	@npm run test:watch

check-deps:
	@echo "Checking dependencies..."
	@command -v glib-compile-schemas >/dev/null || (echo "ERROR: glib-compile-schemas not found" && exit 1)
	@command -v gnome-extensions >/dev/null || (echo "ERROR: gnome-extensions CLI not found" && exit 1)
	@command -v codexbar >/dev/null || echo "WARNING: codexbar CLI not found in PATH"
	@echo "Dependency check complete."

# ============================================================================
# Help
# ============================================================================
help:
	@echo "GNOME CodexBar Extension Makefile"
	@echo ""
	@echo "Build targets:"
	@echo "  all              Build extension (compile schemas)"
	@echo "  clean            Remove build artifacts"
	@echo "  extension        Compile schemas"
	@echo "  validate-schema  Validate schema XML"
	@echo ""
	@echo "Installation:"
	@echo "  install          Install locally (alias for install-local)"
	@echo "  install-local    Install to ~/.local/share/gnome-shell/extensions"
	@echo "  uninstall        Remove installed extension"
	@echo ""
	@echo "Packaging:"
	@echo "  zip-file         Create distributable zip"
	@echo "  dist             Clean and create zip"
	@echo ""
	@echo "Development:"
	@echo "  enable           Enable the extension"
	@echo "  disable          Disable the extension"
	@echo "  restart-shell    Restart GNOME Shell (X11 only)"
	@echo "  logs             Follow GNOME Shell logs"
	@echo "  prefs            Open extension preferences"
	@echo "  info             Show extension info"
	@echo "  dev-loop         Build + install + launch nested GNOME Shell"
	@echo "  check-deps       Check build dependencies"
	@echo ""
	@echo "Variables:"
	@echo "  VERSION=X        Set version number"
	@echo "  DESTDIR=/path    Install to system location"
