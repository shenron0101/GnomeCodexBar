
Focus: rules for usage and testing of features.

Manual smoke checks
- usage-tui show
- usage-tui show --provider claude
- usage-tui show --provider codex --window 5h
- usage-tui show --provider copilot
- usage-tui show --json
- usage-tui doctor
- usage-tui env
- usage-tui tui
- usage-tui login --provider copilot
- usage-tui login --provider claude

Testing rules
- Run usage-tui show and usage-tui tui for UI/CLI changes.

Versioning rules
- ALWAYS read VERSIONLOG.md before making version changes or creating releases
- Extension version in metadata.json is an integer (GNOME requirement), git tags use semantic versioning
- Update VERSIONLOG.md with changes whenever bumping versions
- Extension version numbering: metadata.json uses integers (1, 2, 3...), git tags use v1.0.0, v1.0.1, etc.
- usage-tui uses standard semantic versioning (0.1.0, 0.1.1, etc.)

Commit rules
- Before committing, run the secret-scanner skill to check for env files and secrets, then follow the git-workflow skill.
