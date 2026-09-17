import pytest

from india_voice.config import ConfigurationError, Settings


def valid_env():
    return {
        "LIVEKIT_URL": "wss://test.invalid",
        "LIVEKIT_API_KEY": "test-key",
        "LIVEKIT_API_SECRET": "test-secret",
        "SARVAM_API_KEY": "test-sarvam",
        "LLM_PROVIDER": "openai-compatible",
        "LLM_BASE_URL": "https://test.invalid/v1",
        "LLM_API_KEY": "test-llm",
        "LLM_MODEL": "configured-test-model",
    }


def test_missing_config_reports_names_without_values():
    with pytest.raises(ConfigurationError) as error:
        Settings.from_env({"LLM_API_KEY": "very-private"})
    assert "SARVAM_API_KEY" in str(error.value)
    assert "very-private" not in str(error.value)


@pytest.mark.parametrize("key,value", [
    ("LIVEKIT_URL", "https://bad.invalid"),
    ("LIVEKIT_URL", "ws://public.invalid"),
    ("LLM_BASE_URL", "https://user:secret@test.invalid/v1"),
    ("LLM_BASE_URL", "http://public.invalid/v1"),
    ("VOICE_ENDPOINT_SILENCE_MS", "0"),
    ("SARVAM_TTS_PACE", "2.5"),
    ("SARVAM_TTS_TEMPERATURE", "1.5"),
    ("SARVAM_STT_LANGUAGE", "unknown"),
    ("VOICE_SESSION_SECONDS", "601"),
])
def test_invalid_provider_settings_fail_closed(key, value):
    with pytest.raises(ConfigurationError, match=key):
        Settings.from_env({**valid_env(), key: value})


def test_secrets_are_redacted_and_indic_instructions_are_configurable():
    settings = Settings.from_env({**valid_env(), "VOICE_LANGUAGE": "te-en"})
    assert "test-secret" not in repr(settings)
    assert "Tenglish" in settings.instructions()
    assert "native scripts" in settings.instructions()
    assert settings.sarvam_stt_language == "auto"


def test_loopback_livekit_is_supported_without_external_livekit_account():
    settings = Settings.from_env({**valid_env(), "LIVEKIT_URL": "ws://127.0.0.1:7880"})
    assert settings.livekit_url.endswith(":7880")
