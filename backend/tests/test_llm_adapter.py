"""Tests for the provider-agnostic LLM adapter (backend/services/llm/client.py).

Covers: the factory's no-key / explicit-provider behaviour, retry & backoff on
transient statuses via a stubbed transport, response extraction for each REST
provider, that key material is never surfaced, and FakeProvider determinism.
No test makes a real network call.
"""

from __future__ import annotations

import json

import pytest

from backend.services.llm import (
    FakeProvider,
    GeminiProvider,
    GroqProvider,
    LLMError,
    get_provider,
)
from backend.services.llm.client import HttpResponse


# --------------------------------------------------------------------------- #
# Stub transport helpers
# --------------------------------------------------------------------------- #


def make_transport(script):
    """Return a transport that yields ``script`` entries in order.

    Each entry is an ``(status, body)`` tuple. Records every call so tests can
    assert call counts and that no key leaks into logged material.
    """
    calls = []

    def transport(url, headers, payload, timeout):
        calls.append({"url": url, "headers": headers, "payload": payload})
        status, body = script[min(len(calls) - 1, len(script) - 1)]
        return HttpResponse(status, body)

    transport.calls = calls
    return transport


# --------------------------------------------------------------------------- #
# Factory
# --------------------------------------------------------------------------- #


def test_get_provider_returns_none_without_any_key():
    assert get_provider(env={}) is None


def test_get_provider_prefers_gemini_when_both_keys_present():
    p = get_provider(env={"GEMINI_API_KEY": "g", "GROQ_API_KEY": "q"})
    assert isinstance(p, GeminiProvider)
    assert p.name == "gemini"


def test_get_provider_falls_back_to_groq_when_only_groq_key():
    p = get_provider(env={"GROQ_API_KEY": "q"})
    assert isinstance(p, GroqProvider)


def test_explicit_provider_without_key_returns_none_not_fallback():
    # LLM_PROVIDER names groq but only a gemini key exists -> explicit choice is
    # respected and yields None (no silent fallback to gemini).
    assert get_provider(env={"LLM_PROVIDER": "groq", "GEMINI_API_KEY": "g"}) is None


def test_explicit_fake_provider():
    assert isinstance(get_provider(env={"LLM_PROVIDER": "fake"}), FakeProvider)


def test_explicit_gemini_with_key():
    p = get_provider(env={"LLM_PROVIDER": "gemini", "GEMINI_API_KEY": "g"})
    assert isinstance(p, GeminiProvider)


# --------------------------------------------------------------------------- #
# Retry / backoff
# --------------------------------------------------------------------------- #

_GEMINI_OK = json.dumps({"candidates": [{"content": {"parts": [{"text": "hello"}]}}]})


def test_retries_on_429_then_succeeds():
    transport = make_transport([(429, "slow down"), (429, "slow down"), (200, _GEMINI_OK)])
    slept = []
    p = GeminiProvider("secret", transport=transport, sleep=slept.append, base_delay=0.01)
    assert p.complete("hi") == "hello"
    assert len(transport.calls) == 3
    # Exponential backoff: two sleeps, second is double the first.
    assert len(slept) == 2 and slept[1] == pytest.approx(slept[0] * 2)


def test_non_retryable_status_raises_immediately():
    transport = make_transport([(400, "bad request")])
    p = GeminiProvider("secret", transport=transport, sleep=lambda _: None)
    with pytest.raises(LLMError):
        p.complete("hi")
    assert len(transport.calls) == 1  # no retry on 4xx


def test_retries_exhausted_raises():
    transport = make_transport([(503, "unavailable")])
    p = GeminiProvider("secret", transport=transport, sleep=lambda _: None, max_retries=2)
    with pytest.raises(LLMError):
        p.complete("hi")
    assert len(transport.calls) == 3  # initial + 2 retries


# --------------------------------------------------------------------------- #
# Response extraction + key hygiene
# --------------------------------------------------------------------------- #


def test_gemini_sends_key_in_header_not_url_and_repr_redacts():
    transport = make_transport([(200, _GEMINI_OK)])
    p = GeminiProvider("super-secret-key", transport=transport, sleep=lambda _: None)
    p.complete("hi", system="be terse")
    call = transport.calls[0]
    assert "super-secret-key" not in call["url"]  # key never in URL
    assert call["headers"]["x-goog-api-key"] == "super-secret-key"
    assert "super-secret-key" not in repr(p)
    assert "redacted" in repr(p)


def test_groq_extracts_message_content_and_uses_bearer():
    body = json.dumps({"choices": [{"message": {"content": "  a debate  "}}]})
    transport = make_transport([(200, body)])
    p = GroqProvider("k", transport=transport, sleep=lambda _: None)
    assert p.complete("hi", system="sys") == "a debate"
    assert transport.calls[0]["headers"]["Authorization"] == "Bearer k"
    # system message threaded into the OpenAI-shaped payload
    roles = [m["role"] for m in transport.calls[0]["payload"]["messages"]]
    assert roles == ["system", "user"]


def test_malformed_response_raises_llmerror():
    transport = make_transport([(200, "not json")])
    p = GeminiProvider("k", transport=transport, sleep=lambda _: None)
    with pytest.raises(LLMError):
        p.complete("hi")


# --------------------------------------------------------------------------- #
# FakeProvider
# --------------------------------------------------------------------------- #


def test_fake_provider_canned_responses_round_robin():
    fp = FakeProvider(responses=["a", "b"])
    assert [fp.complete("x") for _ in range(3)] == ["a", "b", "a"]


def test_fake_provider_synthesizes_from_grounding_block():
    grounding = {
        "persona": "quant",
        "home_team": "Alpha",
        "away_team": "Beta",
        "model": {"home": 0.5, "draw": 0.3, "away": 0.2},
        "calibration": {"winner_accuracy_pct": 60.0},
    }
    prompt = f"[GROUNDING_JSON]{json.dumps(grounding)}[/GROUNDING_JSON]"
    out = json.loads(FakeProvider().complete(prompt))
    assert out["text"]
    assert set(out["implied_probs"]) == {"home", "draw", "away"}
    assert out["stance"] == "home"  # 0.5 is the max


# --------------------------------------------------------------------------- #
# Retired-model self-healing (gemini-1.5-flash 404s as of mid-2026)
# --------------------------------------------------------------------------- #

_GEMINI_404 = json.dumps(
    {"error": {"code": 404, "message": "models/gemini-old-flash is not found for API version v1beta"}}
)
_GEMINI_LIST = json.dumps(
    {
        "models": [
            {"name": "models/gemini-2.0-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-2.5-pro-preview", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/embedding-001", "supportedGenerationMethods": ["embedContent"]},
        ]
    }
)


def test_retired_model_resolves_via_list_and_retries():
    transport = make_transport([(404, _GEMINI_404), (200, _GEMINI_LIST), (200, _GEMINI_OK)])
    p = GeminiProvider("secret", model="gemini-old-flash", transport=transport, sleep=lambda _: None)
    assert p.complete("hi") == "hello"
    # POST (404) -> GET ListModels (payload None) -> POST retry on the resolved model.
    assert len(transport.calls) == 3
    assert transport.calls[1]["payload"] is None
    assert p.model == "gemini-2.5-flash"  # newest stable flash wins over lite/preview
    assert "gemini-2.5-flash:generateContent" in transport.calls[2]["url"]


def test_retired_model_with_failed_discovery_reraises_original():
    transport = make_transport([(404, _GEMINI_404), (500, "boom")])
    p = GeminiProvider("secret", model="gemini-old-flash", transport=transport, sleep=lambda _: None)
    with pytest.raises(LLMError, match="HTTP 404"):
        p.complete("hi")


def test_resolved_model_is_reused_for_subsequent_calls():
    transport = make_transport(
        [(404, _GEMINI_404), (200, _GEMINI_LIST), (200, _GEMINI_OK), (200, _GEMINI_OK)]
    )
    p = GeminiProvider("secret", model="gemini-old-flash", transport=transport, sleep=lambda _: None)
    p.complete("hi")
    p.complete("again")
    # Second call goes straight to the resolved model: exactly 4 calls total.
    assert len(transport.calls) == 4
    assert "gemini-2.5-flash:generateContent" in transport.calls[3]["url"]
