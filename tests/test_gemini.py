import pytest
import anyio
from usage_tui.providers.gemini import GeminiProvider
from usage_tui.providers.base import ProviderName, WindowPeriod

def test_gemini_init():
    provider = GeminiProvider()
    assert provider.name == ProviderName.GEMINI
    assert provider.is_configured() is True

@pytest.mark.anyio
async def test_gemini_fetch():
    provider = GeminiProvider()
    result = await provider.fetch(WindowPeriod.HOUR_5)
    assert result.provider == ProviderName.GEMINI
    assert result.metrics.limit == 100.0

@pytest.fixture
def anyio_backend():
    return 'asyncio'
