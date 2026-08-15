# LLM adapter & the Boardroom (internal — not user-facing)

This document is for maintainers. It is **not** surfaced in the product UI. See
`DESIGN.md` §"Copy" — provider names, model/algorithm
names, and pipeline details never appear on the website.

## The one rule: LLM calls run at pipeline time

Every LLM call in this repo happens in **GitHub Actions or a local script**,
never per visitor. The pipeline writes a committed artifact; the product reads
that artifact. **Products talk to artifacts, never models.** This keeps request
volume inside a free tier, makes every surface reproducible, and lets a
deterministic verifier gate output before it is ever committed.

## The adapter (`backend/services/llm/`)

A tiny, provider-agnostic seam. One protocol, swappable implementations, no new
pip dependencies (REST via the standard-library `urllib`).

```python
from backend.services.llm import get_provider

provider = get_provider()          # None if no key is configured
if provider is None:
    ...                            # skip cleanly — pipeline stays green
text = provider.complete(prompt, system=system, max_tokens=512, temperature=0.6)
```

### `Provider` protocol

`complete(prompt, *, system="", max_tokens=1024, temperature=0.7) -> str`, plus
`name` and `model` attributes.

| Implementation   | Backend | Key env var       | Notes |
|------------------|---------|-------------------|-------|
| `GeminiProvider` | Google Generative Language REST | `GEMINI_API_KEY` | Primary. Free-tier Flash (~1,500 req/day). Key sent via `x-goog-api-key` header (never in a URL). Model via `GEMINI_MODEL`. |
| `GroqProvider`   | OpenAI-compatible REST | `GROQ_API_KEY` | Fallback (Llama). Key via `Authorization: Bearer`. Model via `GROQ_MODEL`. |
| `FakeProvider`   | none (offline) | — | Deterministic. Used by tests and `--dry-run`. |

An Anthropic/OpenAI provider could be added the same way without touching
callers — the adapter is provider-agnostic by design.

### `get_provider()` selection

1. Explicit `LLM_PROVIDER` (`gemini` \| `groq` \| `fake`). If the named provider
   needs a key that is absent, returns `None` — an explicit choice is respected,
   never silently downgraded.
2. Otherwise the first provider with a key present, in order **gemini → groq**.
3. Returns `None` cleanly when nothing is configured. It never raises for a
   missing key.

### Reliability & hygiene

- **Retry/backoff:** bounded exponential backoff on `429` and `5xx`; `4xx` fails
  fast. The transport is injectable (`transport=`) for tests.
- **No secret leakage:** keys travel in request headers (never a logged URL);
  headers are never logged; `repr()` redacts the key.

## The Boardroom (`grounding.py`, `build_boardroom.py`)

Three dissenting personas debate one fixture:

- **The Quant** — argues from the prediction's probabilities + calibration record.
- **The Historian** — argues from exact-count historical precedents.
- **The Skeptic** — red-teams overconfidence, citing the most recent wrong
  high-confidence call.

### Grounded generation

`build_boardroom_bundle(match, ...)` assembles a **typed bundle** of only
verifiable facts: the model's 1X2 for the fixture, headline calibration numbers
(`backend/services/prediction/tracker.py`), 2–4 exact-count precedents keyed to
pre-match states (`backend/data/rarity/state_outcomes.json`), recent-form facts
(warehouse, read-only), and the model's most recent wrong high-confidence call.

Each persona receives the bundle inside a `[GROUNDING_JSON]…[/GROUNDING_JSON]`
block and must reply with a single JSON object
`{stance, implied_probs, text, claims}`.

`verify_text(text, bundle)` then rejects the section if it:

1. **States an ungrounded number** — every percent/count/score/minute in the
   prose must resolve to a bundle fact, with tolerant formatting matching
   (`64%` ≡ `64 percent` ≡ `0.64`); or
2. **Uses a banned term** — a data-provider name, a model/algorithm name, or any
   betting vocabulary (list derived from `docs/methodology.md` + `CLAUDE.md`).
   Proper nouns we handed the persona (team/league names) are exempt.

A rejected section is dropped. If fewer than two personas survive, the match
gets **no** debate entry.

### Dissent index

Deterministic, computed only from the structured `implied_probs` fields (never
parsed from prose): the **mean pairwise total-variation distance** between the
three personas' implied 1X2 views. `0.0` = perfect agreement; it approaches
`1.0` as views diverge. Bucketed into `low` / `moderate` / `high`.

### Artifact

`backend/data/boardroom/debates.json`:

```jsonc
{
  "schema": 1, "generated_at": "…", "provider": "gemini", "model": "…", "count": N,
  "debates": {
    "<match_id>": {
      "match_id", "home_team", "away_team", "league", "kickoff", "gender",
      "personas": [ { "name", "key", "stance", "text", "claims": [] } ],
      "dissent_index": 0.0, "dissent_level": "low|moderate|high", "generated_at"
    }
  }
}
```

`provider`/`model` live in the artifact metadata only — that is fine, it is not
the UI. The frontend loader (`src/lib/boardroom.ts`) and the
`/api/v1/boardroom` route read this committed file; `Boardroom.tsx` renders a
match's debate **only if** an entry exists, and nothing otherwise.

## Running it

```bash
# Deterministic, offline (no key, no network). Writes an inspectable artifact.
python -m backend.scripts.build_boardroom --dry-run --days 3

# Real generation once a key exists.
GEMINI_API_KEY=… python -m backend.scripts.build_boardroom --days 3
```

## What happens today (no key configured)

- **Pipeline:** `build_boardroom` prints "no LLM provider key configured … Nothing
  written; exiting 0" and exits `0` **without** writing the artifact.
- **Page:** with no committed `debates.json` (or no entry for the match), the
  `/api/v1/boardroom` route returns `{ debate: null }` and `Boardroom.tsx`
  renders nothing — honest absence, no placeholder.

## Tests

- `backend/tests/test_llm_adapter.py` — factory/no-key behaviour, retry logic
  (stubbed transport), response extraction, key hygiene, FakeProvider.
- `backend/tests/test_boardroom.py` — bundle assembly, verifier accept/reject
  (formatting variants + banned terms), dissent index, `--dry-run` artifact.
- `src/components/prediction/__tests__/Boardroom.test.tsx` — renders from a
  fixture debate; renders nothing without an entry.
