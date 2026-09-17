"""Validated server-only configuration; provider values are never logged."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator

ROOT = Path(__file__).resolve().parents[4]


class ConfigurationError(ValueError):
    pass


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")
    livekit_url: str
    livekit_api_key: SecretStr
    livekit_api_secret: SecretStr
    sarvam_api_key: SecretStr
    llm_provider: Literal["openai-compatible"] = "openai-compatible"
    llm_base_url: str
    llm_api_key: SecretStr
    llm_model: str = Field(min_length=1, max_length=200)
    voice_agent_name: str = Field(default="india-voice-prototype", pattern=r"^[a-z][a-z0-9-]{0,63}$")
    voice_language: Literal["te-IN", "hi-IN", "en-IN", "te-en"] = "en-IN"
    sarvam_stt_language: Literal["auto", "te-IN", "hi-IN", "en-IN"] = "auto"
    sarvam_stt_mode: Literal["codemix", "transcribe", "verbatim"] = "codemix"
    sarvam_stt_stream_type: Literal["fast", "balanced"] = "fast"
    sarvam_tts_language: Literal["te-IN", "hi-IN", "en-IN"] = "en-IN"
    sarvam_tts_speaker: Literal["shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "simran"] = "shubh"
    sarvam_tts_pace: float = Field(default=1.0, ge=0.5, le=2.0)
    sarvam_tts_temperature: float = Field(default=0.6, ge=0.01, le=1.0)
    voice_instructions_file: str = ""
    voice_endpoint_silence_ms: int = Field(default=180, ge=80, le=2000)
    voice_interruption_ms: int = Field(default=80, ge=50, le=1000)
    voice_provider_timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)
    voice_turn_timeout_seconds: float = Field(default=30.0, ge=5.0, le=120.0)
    voice_max_output_characters: int = Field(default=1200, ge=100, le=4000)
    voice_max_output_audio_seconds: float = Field(default=30.0, ge=2.0, le=60.0)
    voice_max_input_seconds: float = Field(default=30.0, ge=5.0, le=60.0)
    voice_session_seconds: int = Field(default=600, ge=30, le=600)
    voice_metrics_directory: str = ".local/voice-metrics"
    voice_latency_p95_target_ms: int = Field(default=500, ge=1)
    voice_latency_profile: str = "unmeasured"

    @field_validator("livekit_api_key", "livekit_api_secret", "sarvam_api_key", "llm_api_key")
    @classmethod
    def require_secret(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("must be configured locally")
        return value

    @field_validator("livekit_url", "llm_base_url")
    @classmethod
    def endpoint(cls, value: str, info) -> str:
        parsed = urlsplit(value)
        allowed = {"wss", "ws"} if info.field_name == "livekit_url" else {"https", "http"}
        if parsed.scheme not in allowed or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("must be a provider URL without embedded credentials/query")
        if parsed.scheme in {"http", "ws"} and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("unencrypted endpoints are allowed only on loopback")
        return value.rstrip("/")

    @classmethod
    def from_env(cls, environment: dict[str, str] | None = None) -> Settings:
        if environment is None:
            load_dotenv(ROOT / ".env", override=False)
            environment = dict(os.environ)
        fields = {name: environment[name.upper()] for name in cls.model_fields if environment.get(name.upper(), "").strip()}
        try:
            return cls.model_validate(fields)
        except ValidationError as error:
            # No values, URLs, secrets or pydantic input payloads in diagnostic output.
            names = sorted({str(item["loc"][0]).upper() for item in error.errors()})
            raise ConfigurationError("Missing or invalid settings: " + ", ".join(names)) from None

    def instructions(self) -> str:
        language = {"te-IN": "Telugu", "hi-IN": "Hindi", "en-IN": "Indian English", "te-en": "natural Telugu-English (Tenglish)"}[self.voice_language]
        base = (
            f"You are a friendly voice conversation prototype for an Indian business. Start in {language}. "
            "Follow the caller's preferred language and natural code-switching between Telugu, Hindi and English. "
            "Write Telugu/Hindi words in their native scripts for synthesis, keeping English words in English. "
            "Use short conversational sentences and one question at a time. Avoid markdown and long lists. "
            "You have no business tools, customer records, payment capability, bookings or ability to place calls. "
            "Never claim an action has been completed or invent prices, availability or facts. "
            "If interrupted, respond to the latest caller request instead of resuming discarded speech. "
            "This is a consented browser test, not a live customer campaign."
        )
        if self.voice_instructions_file:
            file = Path(self.voice_instructions_file)
            if not file.is_absolute():
                file = ROOT / file
            try:
                extra = file.read_text(encoding="utf-8")
            except OSError:
                raise ConfigurationError("VOICE_INSTRUCTIONS_FILE cannot be read") from None
            if len(extra) > 12000:
                raise ConfigurationError("VOICE_INSTRUCTIONS_FILE must be at most 12000 characters")
            base += "\nBusiness conversation instructions:\n" + extra
        return base
