import pytest
from usage_tui.tui import UsageTUI

@pytest.mark.asyncio
async def test_tui_startup():
    """
    Test that the TUI can initialize, mount, and complete its first data fetch
    render cycle without throwing uncaught exceptions (like UnboundLocalError).
    """
    app = UsageTUI()
    
    # Textual's run_test() simulates a headless terminal and allows
    # us to wait for background tasks and UI updates to settle.
    async with app.run_test() as pilot:
        # Wait enough time for the initial async data fetch and watch_result updates to trigger
        await pilot.pause(1.0)
        
        # If any exception occurred in the UI thread or message handlers,
        # it would cause the test context to fail or the app to crash.
        assert app.is_running
