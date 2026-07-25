"""Textual TUI for usage metrics."""

import json
from datetime import datetime, timezone

from textual import on
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, VerticalGroup, VerticalScroll
from textual.reactive import reactive
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Label,
    ProgressBar,
    Rule,
    Static,
    TabbedContent,
    TabPane,
)

from usage_tui.cache import ResultCache
from usage_tui.config import config
from usage_tui.providers import (
    ClaudeOAuthProvider,
    CodexProvider,
    CopilotProvider,
    GoogleProvider,
    OpenAIUsageProvider,
    OpenRouterUsageProvider,
)
from usage_tui.providers.base import (
    BaseProvider,
    ProviderName,
    ProviderResult,
    WindowPeriod,
)


class ProviderCard(Static):
    """A card displaying metrics for a single provider."""

    DEFAULT_CSS = """
    ProviderCard {
        width: 100%;
        height: auto;
        margin: 1 0;
        padding: 1 2;
        border: solid $primary;
        background: $surface;
    }

    ProviderCard.error {
        border: solid $error;
    }

    ProviderCard.unconfigured {
        border: dashed $warning;
        opacity: 0.7;
    }

    ProviderCard .card-title {
        text-style: bold;
        color: $text;
    }

    ProviderCard .card-subtitle {
        color: $text-muted;
        margin-bottom: 1;
    }

    ProviderCard .metric-row {
        width: 100%;
        height: auto;
    }

    ProviderCard .metric-label {
        width: 15;
        color: $text-muted;
    }

    ProviderCard .metric-value {
        color: $success;
        text-style: bold;
    }

    ProviderCard .metric-value.warning {
        color: $warning;
    }

    ProviderCard .metric-value.error {
        color: $error;
    }

    ProviderCard ProgressBar {
        width: 100%;
        margin: 1 0;
    }

    ProviderCard .error-message {
        color: $error;
        margin-top: 1;
    }

    ProviderCard .stale-indicator {
        color: $warning;
        text-style: italic;
    }
    """

    result: reactive[ProviderResult | None] = reactive(None)
    is_loading: reactive[bool] = reactive(False)

    def __init__(
        self,
        provider_name: ProviderName,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self.provider_name = provider_name
        self.provider_info = config.get_provider_status(provider_name)

    def compose(self) -> ComposeResult:
        name = self.provider_info["name"]
        configured = self.provider_info["configured"]

        yield Label(name, classes="card-title")

        if not configured:
            yield Label(
                f"Not configured - set {self.provider_info['env_var']}",
                classes="card-subtitle",
            )
            self.add_class("unconfigured")
            return

        yield Label("Loading...", id="status-line", classes="card-subtitle")
        if self.provider_name == ProviderName.COPILOT:
            yield Label("Window: 30d only", classes="card-subtitle")
        yield VerticalGroup(id="metrics-container")

    def watch_result(self, result: ProviderResult | None) -> None:
        """Update display when result changes."""
        if result is None:
            return

        self.remove_class("error")
        self.remove_class("unconfigured")

        status_line = self.query_one("#status-line", Label)
        metrics_container = self.query_one("#metrics-container", VerticalGroup)
        metrics_container.remove_children()

        if result.is_error:
            self.add_class("error")
            status_line.update(f"Error: {result.error}")
            return

        # Update status line with last update time
        age = datetime.now(timezone.utc) - result.updated_at.replace(tzinfo=timezone.utc)
        age_str = self._format_age(age.total_seconds())
        status_line.update(f"Updated {age_str} ago | Window: {result.window.value}")

        # Build metrics display
        metrics = result.metrics

        # Usage bar for Claude (has limit/remaining)
        if metrics.usage_percent is not None:
            pct = metrics.usage_percent
            bar = ProgressBar(total=100, show_eta=False)
            bar.progress = pct
            metrics_container.mount(bar)

            pct_label = Label(f"{pct:.1f}% used", classes="metric-value")
            if pct > 80:
                pct_label.add_class("warning")
            if pct > 95:
                pct_label.add_class("error")
            metrics_container.mount(pct_label)

        # Reset time
        if metrics.reset_at:
            reset_delta = metrics.reset_at - datetime.now(timezone.utc)
            if reset_delta.total_seconds() > 0:
                reset_str = self._format_duration(reset_delta.total_seconds())
                metrics_container.mount(
                    Horizontal(
                        Label("Resets in:", classes="metric-label"),
                        Label(reset_str, classes="metric-value"),
                        classes="metric-row",
                    )
                )

        # Cost
        if metrics.cost is not None:
            metrics_container.mount(
                Horizontal(
                    Label("Cost:", classes="metric-label"),
                    Label(f"${metrics.cost:.4f}", classes="metric-value"),
                    classes="metric-row",
                )
            )

        # Requests
        if metrics.requests is not None:
            metrics_container.mount(
                Horizontal(
                    Label("Requests:", classes="metric-label"),
                    Label(f"{metrics.requests:,}", classes="metric-value"),
                    classes="metric-row",
                )
            )

        # Tokens
        if metrics.total_tokens is not None:
            tokens_str = f"{metrics.total_tokens:,}"
            if metrics.input_tokens and metrics.output_tokens:
                tokens_str += f" ({metrics.input_tokens:,} in / {metrics.output_tokens:,} out)"
            metrics_container.mount(
                Horizontal(
                    Label("Tokens:", classes="metric-label"),
                    Label(tokens_str, classes="metric-value"),
                    classes="metric-row",
                )
            )

    def watch_is_loading(self, loading: bool) -> None:
        """Update loading state."""
        if not self.provider_info["configured"]:
            return
        status_line = self.query_one("#status-line", Label)
        if loading:
            status_line.update("Loading...")

    def _format_age(self, seconds: float) -> str:
        """Format age in human-readable form."""
        if seconds < 60:
            return f"{int(seconds)}s"
        elif seconds < 3600:
            return f"{int(seconds / 60)}m"
        else:
            return f"{int(seconds / 3600)}h"

    def _format_duration(self, seconds: float) -> str:
        """Format duration in human-readable form."""
        total_minutes = int(seconds // 60)
        days = total_minutes // (24 * 60)
        hours = (total_minutes // 60) % 24
        minutes = total_minutes % 60
        parts = []
        if days > 0:
            parts.append(f"{days}d")
        if hours > 0 or days > 0:
            parts.append(f"{hours}h")
        parts.append(f"{minutes}m")
        return " ".join(parts)


class RawJsonView(Static):
    """View for displaying raw JSON data."""

    DEFAULT_CSS = """
    RawJsonView {
        width: 100%;
        height: 1fr;
        padding: 1;
        background: $surface;
    }

    RawJsonView .json-content {
        width: 100%;
        overflow: auto;
    }
    """

    data: reactive[dict | None] = reactive(None)

    def compose(self) -> ComposeResult:
        yield VerticalScroll(
            Static("No data", id="json-display"),
            classes="json-content",
        )

    def watch_data(self, data: dict | None) -> None:
        """Update JSON display when data changes."""
        display = self.query_one("#json-display", Static)
        if data is None:
            display.update("No data")
        else:
            formatted = json.dumps(data, indent=2, default=str)
            display.update(formatted)


class UsageTUI(App):
    """Main TUI application for usage metrics."""

    CSS = """
    Screen {
        background: $background;
    }

    TabbedContent {
        height: 1fr;
        width: 1fr;
    }

    ContentSwitcher {
        height: 1fr;
    }

    TabPane {
        height: 1fr;
    }

    #main-container {
        width: 100%;
        height: 100%;
        padding: 1 2;
    }

    #overview-tab {
        width: 100%;
        height: 1fr;
        padding: 1;
    }

    #controls {
        width: 100%;
        height: auto;
        margin-bottom: 1;
    }

    #controls Button {
        margin-right: 1;
    }

    .window-button {
        min-width: 6;
    }

    .window-button.active {
        background: $primary;
    }

    #cards-container {
        width: 100%;
        height: 1fr;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
        Binding("5", "window_5h", "5 Hours"),
        Binding("7", "window_7d", "7 Days"),
        Binding("j", "toggle_json", "Toggle JSON"),
    ]

    TITLE = "Usage Metrics TUI"

    window: reactive[WindowPeriod] = reactive(WindowPeriod.DAY_7)
    show_json: reactive[bool] = reactive(False)

    def __init__(self) -> None:
        super().__init__()
        self.cache = ResultCache()
        self.providers: dict[ProviderName, BaseProvider] = {
            ProviderName.CLAUDE: ClaudeOAuthProvider(),
            ProviderName.OPENAI: OpenAIUsageProvider(),
            ProviderName.OPENROUTER: OpenRouterUsageProvider(),
            ProviderName.COPILOT: CopilotProvider(),
            ProviderName.CODEX: CodexProvider(),
            ProviderName.GOOGLE: GoogleProvider(),
        }
        self.results: dict[ProviderName, ProviderResult | None] = {}

    def compose(self) -> ComposeResult:
        yield Header()
        with Container(id="main-container"):
            with TabbedContent():
                with TabPane("Overview", id="overview-tab"):
                    yield Horizontal(
                        Button("Refresh", id="refresh-btn", variant="primary"),
                        Button("5h", id="btn-5h", classes="window-button"),
                        Button("7d", id="btn-7d", classes="window-button active"),
                        id="controls",
                    )
                    yield VerticalScroll(
                        ProviderCard(ProviderName.CLAUDE, id="card-claude"),
                        ProviderCard(ProviderName.OPENAI, id="card-openai"),
                        ProviderCard(ProviderName.OPENROUTER, id="card-openrouter"),
                        ProviderCard(ProviderName.COPILOT, id="card-copilot"),
                        ProviderCard(ProviderName.CODEX, id="card-codex"),
                        ProviderCard(ProviderName.GOOGLE, id="card-google"),
                        id="cards-container",
                    )
                with TabPane("Raw JSON", id="json-tab"):
                    yield RawJsonView(id="json-view")
        yield Footer()

    async def on_mount(self) -> None:
        """Initialize and fetch data on mount."""
        self._update_window_buttons()
        await self.action_refresh()

    @on(Button.Pressed, "#refresh-btn")
    async def on_refresh_pressed(self) -> None:
        """Handle refresh button press."""
        await self.action_refresh()

    @on(Button.Pressed, "#btn-5h")
    async def on_5h_pressed(self) -> None:
        """Handle 5h button press."""
        await self.action_window_5h()

    @on(Button.Pressed, "#btn-7d")
    async def on_7d_pressed(self) -> None:
        """Handle 7d button press."""
        await self.action_window_7d()

    async def action_refresh(self) -> None:
        """Refresh all provider data."""
        for provider_name, provider in self.providers.items():
            if not provider.is_configured():
                continue

            card = self._get_card(provider_name)
            if card:
                card.is_loading = True

            # Check cache first
            cached = self.cache.get(provider_name, self.window)
            if cached:
                self.results[provider_name] = cached
                if card:
                    card.result = cached
                    card.is_loading = False
                continue

            # Fetch fresh data
            try:
                result = await provider.fetch(self.window)
                self.cache.set(result)
                self.results[provider_name] = result
            except Exception as e:
                result = provider._make_error_result(self.window, str(e))
                self.results[provider_name] = result

            if card:
                card.result = result
                card.is_loading = False

        # Update JSON view
        self._update_json_view()

    async def action_window_5h(self) -> None:
        """Switch to 5 hour window."""
        self.window = WindowPeriod.HOUR_5
        self._update_window_buttons()
        self.cache.invalidate()  # Clear cache to force refresh with new window
        await self.action_refresh()

    async def action_window_7d(self) -> None:
        """Switch to 7 day window."""
        self.window = WindowPeriod.DAY_7
        self._update_window_buttons()
        self.cache.invalidate()
        await self.action_refresh()

    async def action_toggle_json(self) -> None:
        """Toggle JSON view."""
        self.show_json = not self.show_json
        tabbed = self.query_one(TabbedContent)
        if self.show_json:
            tabbed.active = "json-tab"
        else:
            tabbed.active = "overview-tab"

    def _get_card(self, provider: ProviderName) -> ProviderCard | None:
        """Get the card widget for a provider."""
        card_id = f"card-{provider.value}"
        try:
            return self.query_one(f"#{card_id}", ProviderCard)
        except Exception:
            return None

    def _update_window_buttons(self) -> None:
        """Update window button states."""
        buttons = {
            WindowPeriod.HOUR_5: "#btn-5h",
            WindowPeriod.DAY_7: "#btn-7d",
        }
        for period, btn_id in buttons.items():
            try:
                btn = self.query_one(btn_id, Button)
                if period == self.window:
                    btn.add_class("active")
                else:
                    btn.remove_class("active")
            except Exception:
                pass

    def _update_json_view(self) -> None:
        """Update the JSON view with current results."""
        json_view = self.query_one("#json-view", RawJsonView)
        data = {}
        for provider_name, result in self.results.items():
            if result:
                data[provider_name.value] = result.model_dump(mode="json")
        json_view.data = data


def run_tui() -> None:
    """Run the TUI application."""
    app = UsageTUI()
    app.run()


if __name__ == "__main__":
    run_tui()
