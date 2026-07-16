"""Provider-agnostic LLM adapter layer.

All LLM work in this repo runs at **pipeline time** (GitHub Actions / local
scripts), never per visitor. Products read committed artifacts; they never call
a model. This package is the single seam through which a pipeline script reaches
a text-generation provider.

Design goals:
* Provider-agnostic: a :class:`Provider` protocol with swappable implementations
  (Gemini, Groq, a deterministic Fake). An Anthropic/OpenAI provider could slot
  in later without touching callers.
* No new dependencies: the REST providers use the standard library (``urllib``).
* Fails soft: :func:`get_provider` returns ``None`` when no key is configured so
  the pipeline stays green before any key exists.
"""

from .client import (
    FakeProvider,
    GeminiProvider,
    GroqProvider,
    LLMError,
    Provider,
    get_provider,
)

__all__ = [
    "Provider",
    "GeminiProvider",
    "GroqProvider",
    "FakeProvider",
    "LLMError",
    "get_provider",
]
