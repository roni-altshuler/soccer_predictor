"""Provider-agnostic text-generation client.

A tiny adapter over the couple of REST APIs we might use at pipeline time. The
public surface is the :class:`Provider` protocol::

    text = provider.complete(prompt, system=..., max_tokens=..., temperature=...)

Implementations:
* :class:`GeminiProvider` — Google Generative Language REST (free-tier Flash is
  the primary provider). Reads ``GEMINI_API_KEY``.
* :class:`GroqProvider`   — OpenAI-compatible REST (fallback). Reads ``GROQ_API_KEY``.
* :class:`FakeProvider`   — deterministic, offline; used by tests and ``--dry-run``.

:func:`get_provider` picks one from the environment and returns ``None`` cleanly
when no key is configured, so a pipeline that has not yet been given a key can
exit 0 without doing anything.

No secret material is ever logged: keys travel in request headers (never in a
logged URL), and headers are never logged.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, List, Optional, Protocol, runtime_checkable

logger = logging.getLogger("pitchverse.llm")

# HTTP statuses worth retrying with backoff (transient / rate-limit).
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class LLMError(RuntimeError):
    """Raised when a provider call fails in a non-retryable way (or exhausts retries)."""


@dataclass
class HttpResponse:
    status: int
    body: str


# A transport is any callable (url, headers, payload, timeout) -> HttpResponse.
# Injectable so tests can stub the network without monkeypatching urllib.
# A ``None`` payload means a GET request (used for model discovery).
Transport = Callable[[str, dict, Optional[dict], float], HttpResponse]


def _urllib_transport(url: str, headers: dict, payload: Optional[dict], timeout: float) -> HttpResponse:
    """Default transport via the standard library: POST with a JSON body, or GET when payload is None."""
    if payload is None:
        req = urllib.request.Request(url, headers=headers, method="GET")
    else:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed hosts)
            return HttpResponse(getattr(resp, "status", 200), resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:  # 4xx/5xx come back here
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")
        except Exception:  # pragma: no cover - defensive
            pass
        return HttpResponse(exc.code, body)
    except urllib.error.URLError as exc:  # DNS / connection — treat as retryable 503
        logger.warning("llm transport error: %s", exc.reason)
        return HttpResponse(503, str(exc.reason))


@runtime_checkable
class Provider(Protocol):
    """The one method every provider implements."""

    name: str
    model: str

    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        max_tokens: int = 1024,
        temperature: float = 0.7,
        json_output: bool = False,
    ) -> str:
        ...


class _RestProvider:
    """Shared retry/backoff + logging for the HTTP-backed providers."""

    name = "rest"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        transport: Optional[Transport] = None,
        sleep: Callable[[float], None] = time.sleep,
        max_retries: int = 3,
        base_delay: float = 0.5,
        timeout: float = 30.0,
    ) -> None:
        # The key is held privately and never surfaced in logs or ``repr``.
        self._api_key = api_key
        self.model = model
        self._transport = transport or _urllib_transport
        self._sleep = sleep
        self._max_retries = max_retries
        self._base_delay = base_delay
        self._timeout = timeout

    def __repr__(self) -> str:  # never leak the key
        return f"<{type(self).__name__} model={self.model!r} key=***redacted***>"

    def _post(self, url: str, headers: dict, payload: dict) -> str:
        """POST with bounded exponential backoff on transient failures.

        Returns the raw response body on success; raises :class:`LLMError` on a
        non-retryable status or once retries are exhausted.
        """
        delay = self._base_delay
        last_status = 0
        for attempt in range(self._max_retries + 1):
            resp = self._transport(url, headers, payload, self._timeout)
            last_status = resp.status
            if resp.status < 400:
                logger.debug(
                    "llm ok provider=%s model=%s status=%s bytes=%d attempt=%d",
                    self.name,
                    self.model,
                    resp.status,
                    len(resp.body or ""),
                    attempt,
                )
                return resp.body
            if resp.status in _RETRYABLE_STATUS and attempt < self._max_retries:
                wait = delay
                if resp.status == 429:
                    # Providers often state their own cool-down (Google:
                    # RetryInfo `"retryDelay": "39s"`). Honour it when longer.
                    m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s?"', resp.body or "")
                    if m:
                        wait = max(wait, float(m.group(1)) + 1.0)
                logger.warning(
                    "llm retry provider=%s status=%s attempt=%d/%d backoff=%.2fs",
                    self.name,
                    resp.status,
                    attempt + 1,
                    self._max_retries,
                    wait,
                )
                self._sleep(wait)
                delay *= 2
                continue
            # Non-retryable, or out of retries. Body may carry a provider error
            # message but never the request headers/key.
            raise LLMError(
                f"{self.name} request failed: HTTP {resp.status} "
                f"{(resp.body or '')[:300]}"
            )
        raise LLMError(f"{self.name} request failed after retries: HTTP {last_status}")


class GeminiProvider(_RestProvider):
    """Google Generative Language REST (``generativelanguage.googleapis.com``).

    The API key is sent via the ``x-goog-api-key`` header (not the URL query) so
    it never appears in a logged URL. ``model`` is configurable via
    ``GEMINI_MODEL`` (default ``gemini-2.5-flash``). Google retires model ids on
    a cadence (gemini-1.5-flash 404s as of mid-2026), so a "model not found"
    response triggers one ListModels lookup to resolve the newest stable Flash
    model and a single retry — the resolved id is kept for the process.
    """

    name = "gemini"
    _BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, model: Optional[str] = None, **kwargs) -> None:
        super().__init__(api_key, model or os.getenv("GEMINI_MODEL", "gemini-2.5-flash"), **kwargs)

    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        max_tokens: int = 1024,
        temperature: float = 0.7,
        json_output: bool = False,
    ) -> str:
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._api_key}
        generation_config: dict = {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
            # 2.5-generation Flash models "think" by default and the thinking
            # tokens count against maxOutputTokens — a modest budget can be
            # consumed before a single output token, yielding empty/truncated
            # text. This narration task hands the model every fact it needs,
            # so thinking is disabled. (Removed on retry if a model rejects it.)
            "thinkingConfig": {"thinkingBudget": 0},
        }
        if json_output:
            generation_config["responseMimeType"] = "application/json"
        payload: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": generation_config,
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        try:
            body = self._post(f"{self._BASE}/{self.model}:generateContent", headers, payload)
        except LLMError as exc:
            msg = str(exc)
            if "HTTP 400" in msg and "thinking" in msg.lower():
                # Model doesn't accept a thinking budget — retry without one.
                generation_config.pop("thinkingConfig", None)
                body = self._post(f"{self._BASE}/{self.model}:generateContent", headers, payload)
            elif "HTTP 404" in msg:
                resolved = self._resolve_current_flash()
                if not resolved or resolved == self.model:
                    raise
                logger.warning("gemini: model %r unavailable; switching to %r", self.model, resolved)
                self.model = resolved
                body = self._post(f"{self._BASE}/{self.model}:generateContent", headers, payload)
            else:
                raise
        return self._extract_text(body)

    def _resolve_current_flash(self) -> Optional[str]:
        """ListModels -> newest stable Flash model that supports generateContent.

        Preference order: stable ``gemini-<ver>-flash`` (highest version), then
        stable ``gemini-<ver>-flash-lite``, then any non-preview/exp flash. None
        when the lookup fails or nothing suitable exists — the caller re-raises
        the original error in that case.
        """
        try:
            resp = self._transport(
                f"{self._BASE}?pageSize=200",
                {"x-goog-api-key": self._api_key},
                None,
                self._timeout,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("gemini: model discovery failed: %s", exc)
            return None
        if resp.status >= 400:
            logger.warning("gemini: model discovery failed: HTTP %s", resp.status)
            return None
        try:
            models = json.loads(resp.body).get("models", [])
        except (ValueError, AttributeError):
            return None

        def rank(name: str) -> tuple:
            m = re.match(r"^gemini-(\d+(?:\.\d+)?)-flash$", name)
            if m:
                return (3, float(m.group(1)))
            m = re.match(r"^gemini-(\d+(?:\.\d+)?)-flash-lite$", name)
            if m:
                return (2, float(m.group(1)))
            if "flash" in name and not any(t in name for t in ("preview", "exp")):
                return (1, 0.0)
            return (0, 0.0)

        best: Optional[str] = None
        best_rank = (0, 0.0)
        for entry in models:
            if "generateContent" not in entry.get("supportedGenerationMethods", []):
                continue
            name = str(entry.get("name", "")).split("/", 1)[-1]
            r = rank(name)
            if r > best_rank:
                best, best_rank = name, r
        return best if best_rank >= (1, 0.0) and best_rank != (0, 0.0) else None

    @staticmethod
    def _extract_text(body: str) -> str:
        try:
            data = json.loads(body)
            parts = data["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts).strip()
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            raise LLMError(f"gemini: unexpected response shape ({exc})")


class GroqProvider(_RestProvider):
    """Groq OpenAI-compatible chat completions (fallback, Llama models).

    ``model`` is configurable via ``GROQ_MODEL`` (default
    ``llama-3.1-8b-instant``). The key travels in the ``Authorization`` header.
    """

    name = "groq"
    _URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str, model: Optional[str] = None, **kwargs) -> None:
        super().__init__(api_key, model or os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"), **kwargs)

    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        max_tokens: int = 1024,
        temperature: float = 0.7,
        json_output: bool = False,
    ) -> str:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_output:
            payload["response_format"] = {"type": "json_object"}
        body = self._post(self._URL, headers, payload)
        return self._extract_text(body)

    @staticmethod
    def _extract_text(body: str) -> str:
        try:
            data = json.loads(body)
            return (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            raise LLMError(f"groq: unexpected response shape ({exc})")


class FakeProvider:
    """Deterministic, offline provider for tests and ``--dry-run``.

    Two modes:
    * ``FakeProvider(responses=[...])`` — returns the canned strings in order
      (round-robin). Used by adapter/factory tests that need exact control.
    * ``FakeProvider()`` — parses the ``[GROUNDING_JSON]...[/GROUNDING_JSON]``
      block that the Boardroom prompt embeds and synthesizes a valid, grounded
      persona response from it. This is what makes ``--dry-run`` work
      end-to-end without a network or a key: every number the synthesizer emits
      is copied from the grounding block, so the verifier accepts it.
    """

    name = "fake"
    model = "fake-realizer-1"

    def __init__(self, responses: Optional[List[str]] = None) -> None:
        self._responses = list(responses) if responses is not None else None
        self._i = 0

    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        max_tokens: int = 1024,
        temperature: float = 0.7,
        json_output: bool = False,
    ) -> str:
        if self._responses is not None:
            out = self._responses[self._i % len(self._responses)]
            self._i += 1
            return out
        grounding = _extract_grounding(prompt)
        if grounding is None:
            # No structured grounding — return an empty, harmless JSON object.
            return json.dumps({"stance": "draw", "implied_probs": {}, "text": "", "claims": []})
        return synthesize_persona_response(grounding)


# --------------------------------------------------------------------------- #
# Fake realizer: grounding dict -> persona JSON string
# --------------------------------------------------------------------------- #

GROUNDING_OPEN = "[GROUNDING_JSON]"
GROUNDING_CLOSE = "[/GROUNDING_JSON]"


def _extract_grounding(prompt: str) -> Optional[dict]:
    start = prompt.find(GROUNDING_OPEN)
    end = prompt.find(GROUNDING_CLOSE)
    if start == -1 or end == -1 or end < start:
        return None
    raw = prompt[start + len(GROUNDING_OPEN) : end].strip()
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _pct(x: float) -> str:
    """Render a 0-1 probability as a whole-number percent string, e.g. 0.387 -> '39'."""
    return f"{round(x * 100)}"


def synthesize_persona_response(g: dict) -> str:
    """Deterministically turn a grounding dict into a grounded persona JSON string.

    Consumes only the generic grounding fields (``persona``, ``model``,
    ``base_rate``, ``calibration``, ``top_precedent``, ``recent_miss``). Every
    numeric token in the prose is copied verbatim from the grounding, so the
    downstream verifier accepts the text.
    """
    persona = g.get("persona", "quant")
    model = g.get("model", {})
    home = g.get("home_team", "the home side")
    away = g.get("away_team", "the away side")
    m_home = float(model.get("home", 0.34))
    m_draw = float(model.get("draw", 0.33))
    m_away = float(model.get("away", 0.33))

    if persona == "quant":
        implied = {"home": m_home, "draw": m_draw, "away": m_away}
        lean = _lean(implied)
        cal = g.get("calibration", {})
        acc = cal.get("winner_accuracy_pct")
        acc_clause = (
            f" On completed calls the model's winner accuracy sits at {acc}%."
            if acc is not None
            else ""
        )
        text = (
            f"Read straight off the numbers, this leans {lean}: {home} {_pct(m_home)}%, "
            f"draw {_pct(m_draw)}%, {away} {_pct(m_away)}%.{acc_clause} "
            "Nothing here argues for a strong lean either way."
        )
        claims = [f"{home} {_pct(m_home)}% / draw {_pct(m_draw)}% / {away} {_pct(m_away)}%"]

    elif persona == "historian":
        br = g.get("base_rate", {"home": m_home, "draw": m_draw, "away": m_away})
        implied = {
            "home": float(br.get("home", m_home)),
            "draw": float(br.get("draw", m_draw)),
            "away": float(br.get("away", m_away)),
        }
        prec = g.get("top_precedent")
        if prec:
            text = (
                f"History is blunter than the model. {prec['label']}: across {prec['n']} such matches "
                f"the eventual split was {prec['w']} wins, {prec['d']} draws and {prec['l']} losses. "
                "Precedent pulls toward the base rate, not a confident pick."
            )
            claims = [f"{prec['label']} — {prec['w']}/{prec['d']}/{prec['l']} of {prec['n']}"]
        else:
            text = (
                "The precedent shelf is thin for this exact fixture, so I defer to broad base rates "
                "rather than invent a pattern."
            )
            claims = []

    else:  # skeptic
        # Hedge toward the flat 1/3 prior — the Skeptic distrusts sharp edges.
        implied = {
            "home": (m_home + 1 / 3) / 2,
            "draw": (m_draw + 1 / 3) / 2,
            "away": (m_away + 1 / 3) / 2,
        }
        cal = g.get("calibration", {})
        hi = cal.get("high_conf_accuracy_pct")
        miss = g.get("recent_miss")
        hi_clause = (
            f" High-confidence calls land at {hi}%, not a certainty."
            if hi is not None
            else ""
        )
        if miss:
            text = (
                f"Before anyone anchors on the favourite: the most recent high-confidence miss was "
                f"{miss['home_team']} v {miss['away_team']}, called at {miss['confidence_pct']}% and wrong."
                f"{hi_clause} Treat the edge as soft."
            )
            claims = [
                f"recent miss: {miss['home_team']} v {miss['away_team']} at {miss['confidence_pct']}%"
            ]
        else:
            text = (
                "No fresh blow-up to point at, but confident-looking splits still resolve as coin-flips "
                "often enough that I would not over-read this one." + hi_clause
            )
            claims = []

    total = sum(implied.values()) or 1.0
    implied = {k: round(v / total, 4) for k, v in implied.items()}
    return json.dumps(
        {
            "stance": _lean(implied),
            "implied_probs": implied,
            "text": text,
            "claims": claims,
        }
    )


def _lean(probs: dict) -> str:
    if not probs:
        return "draw"
    return max(probs, key=lambda k: probs[k])


# --------------------------------------------------------------------------- #
# Factory
# --------------------------------------------------------------------------- #


def get_provider(
    *,
    env: Optional[dict] = None,
    transport: Optional[Transport] = None,
    **provider_kwargs,
) -> Optional[Provider]:
    """Pick a provider from the environment, or return ``None`` if none is usable.

    Selection order:
    1. Explicit ``LLM_PROVIDER`` (``gemini`` | ``groq`` | ``fake``). If the named
       provider needs a key that is absent, returns ``None`` (does not fall back
       silently — an explicit choice is respected).
    2. Otherwise the first provider with a key present, in the order
       gemini -> groq.

    Returns ``None`` cleanly when no key is configured. Never raises for a
    missing key — the pipeline is expected to treat ``None`` as "skip".
    """
    env = os.environ if env is None else env
    gemini_key = (env.get("GEMINI_API_KEY") or "").strip()
    groq_key = (env.get("GROQ_API_KEY") or "").strip()
    explicit = (env.get("LLM_PROVIDER") or "").strip().lower()

    def _make(kind: str) -> Optional[Provider]:
        if kind == "fake":
            return FakeProvider()
        if kind == "gemini":
            if not gemini_key:
                logger.info("llm: LLM_PROVIDER=gemini but GEMINI_API_KEY is unset")
                return None
            return GeminiProvider(gemini_key, transport=transport, **provider_kwargs)
        if kind == "groq":
            if not groq_key:
                logger.info("llm: LLM_PROVIDER=groq but GROQ_API_KEY is unset")
                return None
            return GroqProvider(groq_key, transport=transport, **provider_kwargs)
        return None

    if explicit:
        return _make(explicit)
    if gemini_key:
        return _make("gemini")
    if groq_key:
        return _make("groq")
    logger.info("llm: no provider key configured (GEMINI_API_KEY / GROQ_API_KEY absent)")
    return None
