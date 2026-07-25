from usage_tui.providers.google import GoogleProvider


def test_maps_antigravity_model_display_names():
    raw = GoogleProvider._quota_to_raw({
        "models": {
            "opaque-pro": {"displayName": "Gemini 3 Pro", "quotaInfo": {"remainingFraction": 0.8}},
            "opaque-flash": {
                "displayName": "Gemini 3 Flash",
                "quotaInfo": {"remainingFraction": 0.9},
            },
            "opaque-claude": {
                "displayName": "Claude Sonnet",
                "quotaInfo": {"remainingFraction": 1.0},
            },
            "opaque-gpt": {"displayName": "GPT-OSS 120B", "quotaInfo": {"remainingFraction": 0.7}},
        }
    })

    assert raw["gemini_pro"]["utilization"] == 20.0
    assert raw["gemini_flash"]["utilization"] == 10.0
    assert raw["claude"]["utilization"] == 0.0
    assert raw["gpt_oss"]["utilization"] == 30.0
