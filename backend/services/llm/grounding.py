"""Grounding for the Boardroom debate: the typed input bundle + the verifier.

The whole game here is *grounded generation*. A persona (The Quant / The
Historian / The Skeptic) may only narrate facts we hand it in a typed bundle.
After generation a deterministic verifier re-reads the prose and **rejects** any
output that (a) states a number not present in the bundle, or (b) uses a banned
term (a data-provider name, a model/algorithm name, or betting vocabulary).

Nothing in this module touches the network or a model — it builds the bundle
from already-fetched facts and checks strings.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set

# --------------------------------------------------------------------------- #
# Personas
# --------------------------------------------------------------------------- #

PERSONAS: List[str] = ["quant", "historian", "skeptic"]

PERSONA_TITLES: Dict[str, str] = {
    "quant": "The Quant",
    "historian": "The Historian",
    "skeptic": "The Skeptic",
}

PERSONA_MANDATES: Dict[str, str] = {
    "quant": (
        "You argue strictly from the prediction's own probabilities and its "
        "calibration record. You do not appeal to history or vibes."
    ),
    "historian": (
        "You argue only from historical precedent — exact counts of what has "
        "happened before in comparable match states. You ignore the current "
        "prediction's confidence."
    ),
    "skeptic": (
        "You red-team the confident view. You cite the calibration record and "
        "the most recent high-confidence call that turned out wrong, and you "
        "argue against over-reading any edge."
    ),
}

# --------------------------------------------------------------------------- #
# Banned vocabulary (derived from docs/methodology.md provider/algorithm names,
# CLAUDE.md's copy-provenance rule, and the no-betting-language rule). Matched
# case-insensitively on whole words so ordinary prose ("below", "between",
# "developed") is never tripped.
# --------------------------------------------------------------------------- #

_BANNED_TERMS: List[str] = [
    # data providers / third-party sources
    "espn", "fotmob", "fbref", "understat", "clubelo", "openfootball",
    "open-meteo", "openmeteo", "football-data", "api-football", "transfermarkt",
    "sofascore", "opta", "openweather",
    # LLM providers / model families
    "gemini", "groq", "llama", "anthropic", "claude", "openai", "gpt", "mistral",
    # model / algorithm names
    "elo", "poisson", "dixon-coles", "dixon coles", "xgboost", "lightgbm",
    "pytorch", "scikit", "monte carlo", "bivariate", "logistic regression",
    "gradient boosting", "neural network", "neural net",
    # pipeline / internal plumbing
    "pipeline", "warehouse", "calibrator", "scaler",
    # betting vocabulary
    "bet", "bets", "betting", "bettor", "odds", "bookmaker", "bookie", "wager",
    "wagers", "stake", "stakes", "punt", "accumulator", "parlay", "moneyline",
    "handicap", "spread bet",
]

_BANNED_RE = re.compile(
    r"(?<!\w)(?:" + "|".join(re.escape(t) for t in _BANNED_TERMS) + r")(?!\w)",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- #
# Typed bundle
# --------------------------------------------------------------------------- #


@dataclass
class Precedent:
    """An exact-count historical fact keyed to a (pre-)match state."""

    label: str
    n: int
    w: int
    d: int
    l: int

    @property
    def win_pct(self) -> float:
        return round(self.w / self.n * 100, 1) if self.n else 0.0

    def as_fractions(self) -> Dict[str, float]:
        if not self.n:
            return {"home": 1 / 3, "draw": 1 / 3, "away": 1 / 3}
        return {
            "home": round(self.w / self.n, 4),
            "draw": round(self.d / self.n, 4),
            "away": round(self.l / self.n, 4),
        }


@dataclass
class TeamForm:
    team: str
    played: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int


@dataclass
class RecentMiss:
    home_team: str
    away_team: str
    predicted_winner: str
    confidence_pct: float
    actual_winner: str
    match_date: str


@dataclass
class BoardroomBundle:
    """Everything a persona is allowed to know about one fixture."""

    match_id: str
    home_team: str
    away_team: str
    league: str
    gender: str
    kickoff: str

    # model outputs (probabilities as 0-1 fractions)
    home_p: float
    draw_p: float
    away_p: float
    home_xg: float
    away_xg: float
    predicted_scoreline: str
    lean: str

    # calibration / accuracy headline (percent scale, or None if unavailable)
    winner_accuracy_pct: Optional[float] = None
    high_conf_accuracy_pct: Optional[float] = None
    brier: Optional[float] = None
    ece: Optional[float] = None
    calibration_sample: Optional[int] = None

    precedents: List[Precedent] = field(default_factory=list)
    base_rate: Optional[Precedent] = None
    home_form: Optional[TeamForm] = None
    away_form: Optional[TeamForm] = None
    recent_miss: Optional[RecentMiss] = None

    # ---- prompt payload -------------------------------------------------- #

    def to_prompt_payload(self, persona: str) -> dict:
        """The generic grounding dict embedded in the persona prompt.

        Real providers read these facts and the instructions around them; the
        FakeProvider parses this block to synthesize a grounded response.
        """
        model = {
            "home": round(self.home_p, 4),
            "draw": round(self.draw_p, 4),
            "away": round(self.away_p, 4),
            "home_xg": self.home_xg,
            "away_xg": self.away_xg,
            "scoreline": self.predicted_scoreline,
        }
        payload: dict = {
            "persona": persona,
            "home_team": self.home_team,
            "away_team": self.away_team,
            "league": self.league,
            "kickoff": self.kickoff,
            "model": model,
            "base_rate": (self.base_rate.as_fractions() if self.base_rate else model),
            "calibration": {
                k: v
                for k, v in {
                    "winner_accuracy_pct": self.winner_accuracy_pct,
                    "high_conf_accuracy_pct": self.high_conf_accuracy_pct,
                    "brier": self.brier,
                    "sample": self.calibration_sample,
                }.items()
                if v is not None
            },
        }
        if self.precedents:
            p = self.precedents[0]
            payload["top_precedent"] = {"label": p.label, "n": p.n, "w": p.w, "d": p.d, "l": p.l}
        if self.recent_miss:
            m = self.recent_miss
            payload["recent_miss"] = {
                "home_team": m.home_team,
                "away_team": m.away_team,
                "confidence_pct": m.confidence_pct,
                "predicted_winner": m.predicted_winner,
                "actual_winner": m.actual_winner,
            }
        return payload

    # ---- allowed numbers ------------------------------------------------- #

    def proper_nouns(self) -> Set[str]:
        nouns = {self.home_team, self.away_team, self.league}
        if self.recent_miss:
            nouns.add(self.recent_miss.home_team)
            nouns.add(self.recent_miss.away_team)
        if self.home_form:
            nouns.add(self.home_form.team)
        if self.away_form:
            nouns.add(self.away_form.team)
        return {n for n in nouns if n}

    def allowed_number_keys(self) -> Set[str]:
        keys: Set[str] = set()
        for v in (self.home_p, self.draw_p, self.away_p):
            keys |= _number_keys(v)
        for v in (self.home_xg, self.away_xg):
            keys |= _number_keys(v)
        for n in _score_components(self.predicted_scoreline):
            keys |= _number_keys(n)
        for v in (
            self.winner_accuracy_pct,
            self.high_conf_accuracy_pct,
            self.brier,
            self.ece,
            self.calibration_sample,
        ):
            if v is not None:
                keys |= _number_keys(float(v))
        precedents = list(self.precedents)
        if self.base_rate is not None:
            precedents.append(self.base_rate)
        for p in precedents:
            for v in (p.n, p.w, p.d, p.l, p.win_pct):
                keys |= _number_keys(float(v))
        for form in (self.home_form, self.away_form):
            if form is not None:
                for v in (
                    form.played,
                    form.wins,
                    form.draws,
                    form.losses,
                    form.goals_for,
                    form.goals_against,
                ):
                    keys |= _number_keys(float(v))
        if self.recent_miss is not None:
            keys |= _number_keys(float(self.recent_miss.confidence_pct))
        return keys


# --------------------------------------------------------------------------- #
# Number normalization — tolerant formatting matching
# --------------------------------------------------------------------------- #


def _fmt(v: float) -> str:
    """Compact numeric string: drop a trailing ``.0`` but keep real decimals."""
    if v == int(v):
        return str(int(v))
    return f"{v:g}"


def _number_keys(v: float) -> Set[str]:
    """All string forms a bundle number could be legitimately written as.

    Handles the "64%" vs "64 percent" vs "0.64" family: a fraction contributes
    both its 2/3-decimal fraction forms and its percent (round/floor/ceil)
    forms; a percent contributes its fraction forms too; counts contribute only
    themselves.
    """
    keys: Set[str] = set()
    keys.add(_fmt(v))
    keys.add(str(int(round(v))))
    if 0 <= v <= 1:  # a probability/fraction
        keys.add(f"{v:.2f}")
        keys.add(f"{v:.3f}")
        pct = v * 100
        keys.add(_fmt(round(pct, 1)))
        keys.add(str(int(round(pct))))
        keys.add(str(int(math.floor(pct))))
        keys.add(str(int(math.ceil(pct))))
    if 1 < v <= 100:  # a percent-scale value
        frac = v / 100
        keys.add(f"{frac:.2f}")
        keys.add(f"{frac:.3f}")
    return keys


_SCORE_RE = re.compile(r"(\d+)\s*[-–]\s*(\d+)")
_PCT_RE = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:%|percent\b)", re.IGNORECASE)
_NUM_RE = re.compile(r"\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?")


def _score_components(scoreline: str) -> List[float]:
    out: List[float] = []
    for m in _SCORE_RE.finditer(scoreline or ""):
        out.extend([float(m.group(1)), float(m.group(2))])
    return out


def _to_float(token: str) -> float:
    return float(token.replace(",", ""))


def extract_numbers(text: str) -> List[str]:
    """Every numeric mention in ``text``, as the raw tokens found.

    Percentages, decimals, comma-grouped counts, scoreline components (``2-1``),
    ordinals (``70th``) and minute marks (``45'``) are all surfaced.
    """
    tokens: List[str] = []
    remaining = text or ""
    # Scoreline components first, then strip so they aren't re-read.
    for m in _SCORE_RE.finditer(remaining):
        tokens.extend([m.group(1), m.group(2)])
    remaining = _SCORE_RE.sub("  ", remaining)
    # Percentages (record with a trailing % marker so keys treat them as pct).
    for m in _PCT_RE.finditer(remaining):
        tokens.append(m.group(1) + "%")
    remaining = _PCT_RE.sub("  ", remaining)
    # Everything else numeric.
    for m in _NUM_RE.finditer(remaining):
        tokens.append(m.group(0))
    return tokens


def _token_keys(token: str) -> Set[str]:
    is_pct = token.endswith("%")
    raw = _to_float(token[:-1] if is_pct else token)
    if is_pct:
        # a percent citation: allow both the percent value and its fraction
        keys = {_fmt(raw), str(int(round(raw)))}
        keys.add(f"{raw / 100:.2f}")
        keys.add(f"{raw / 100:.3f}")
        return keys
    return _number_keys(raw)


# --------------------------------------------------------------------------- #
# Verifier
# --------------------------------------------------------------------------- #


@dataclass
class VerifyResult:
    ok: bool
    ungrounded_numbers: List[str] = field(default_factory=list)
    banned_terms: List[str] = field(default_factory=list)

    @property
    def reason(self) -> str:
        parts = []
        if self.banned_terms:
            parts.append("banned terms: " + ", ".join(sorted(set(self.banned_terms))))
        if self.ungrounded_numbers:
            parts.append("ungrounded numbers: " + ", ".join(self.ungrounded_numbers))
        return "; ".join(parts) or "ok"


def verify_text(
    text: str,
    bundle: BoardroomBundle,
    *,
    extra_claims: Sequence[str] = (),
) -> VerifyResult:
    """Reject text that states an ungrounded number or a banned term.

    Proper nouns we handed the persona (team/league names) are stripped before
    the banned-term scan so echoing, e.g., a club named "Real Betis" never
    trips the "bet" rule.
    """
    combined = " ".join([text or "", *[c or "" for c in extra_claims]])

    # Banned terms — but not inside names we supplied.
    scan = combined
    for noun in bundle.proper_nouns():
        scan = re.sub(re.escape(noun), " ", scan, flags=re.IGNORECASE)
    banned = [m.group(0) for m in _BANNED_RE.finditer(scan)]

    # Numbers — every mention must resolve to a bundle fact.
    allowed = bundle.allowed_number_keys()
    ungrounded: List[str] = []
    for token in extract_numbers(combined):
        if not (_token_keys(token) & allowed):
            ungrounded.append(token)

    return VerifyResult(ok=not banned and not ungrounded, ungrounded_numbers=ungrounded, banned_terms=banned)


# --------------------------------------------------------------------------- #
# Bundle assembly from already-fetched facts
# --------------------------------------------------------------------------- #


def _norm_prob(x: float) -> float:
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0.0
    return x / 100.0 if x > 1.0 else x


def _norm_pct(x: Optional[float]) -> Optional[float]:
    """Return a value on the 0-100 percent scale, or None."""
    if x is None:
        return None
    x = float(x)
    return round(x * 100, 1) if x <= 1.0 else round(x, 1)


def build_boardroom_bundle(
    match: dict,
    *,
    gender: Optional[str] = None,
    metrics: Optional[dict] = None,
    rarity_states: Optional[dict] = None,
    home_form: Optional[TeamForm] = None,
    away_form: Optional[TeamForm] = None,
    recent_miss: Optional[RecentMiss] = None,
) -> BoardroomBundle:
    """Assemble a :class:`BoardroomBundle` from a prediction record + context.

    ``match``          — one committed PredictionRecord dict.
    ``metrics``        — ``ModelAccuracyMetrics.to_dict()`` (or a subset).
    ``rarity_states``  — the ``states`` map from the rarity artifact.
    ``home_form`` / ``away_form`` / ``recent_miss`` — pre-fetched, may be None.

    Every source is optional; whatever is missing is simply omitted (honest
    absence). Nothing here fabricates a value.
    """
    g = (gender or match.get("gender") or "M").upper()
    g = "F" if g in ("F", "WOMEN", "W") else "M"

    home_p = _norm_prob(match.get("predicted_home_win", 0.0))
    draw_p = _norm_prob(match.get("predicted_draw", 0.0))
    away_p = _norm_prob(match.get("predicted_away_win", 0.0))
    total = home_p + draw_p + away_p or 1.0
    home_p, draw_p, away_p = home_p / total, draw_p / total, away_p / total
    lean = max(
        (("home", home_p), ("draw", draw_p), ("away", away_p)),
        key=lambda kv: kv[1],
    )[0]

    precedents, base_rate = _build_precedents(g, rarity_states)

    m = metrics or {}
    bundle = BoardroomBundle(
        match_id=str(match.get("match_id")),
        home_team=match.get("home_team", "Home"),
        away_team=match.get("away_team", "Away"),
        league=match.get("league", "Match"),
        gender=g,
        kickoff=str(match.get("match_date", "")),
        home_p=round(home_p, 4),
        draw_p=round(draw_p, 4),
        away_p=round(away_p, 4),
        home_xg=round(float(match.get("predicted_home_goals", 0.0) or 0.0), 2),
        away_xg=round(float(match.get("predicted_away_goals", 0.0) or 0.0), 2),
        predicted_scoreline=str(match.get("predicted_scoreline", "")),
        lean=lean,
        winner_accuracy_pct=_norm_pct(m.get("winner_accuracy")),
        high_conf_accuracy_pct=_norm_pct(m.get("high_confidence_accuracy")),
        brier=round(float(m["brier_score"]), 3) if m.get("brier_score") else None,
        ece=round(float(m["expected_calibration_error"]), 3)
        if m.get("expected_calibration_error")
        else None,
        calibration_sample=int(m["completed_predictions"]) if m.get("completed_predictions") else None,
        precedents=precedents,
        base_rate=base_rate,
        home_form=home_form,
        away_form=away_form,
        recent_miss=recent_miss,
    )
    return bundle


# The pre-match states we surface, keyed to the rarity artifact grid. All are
# exact counts; win/draw/loss are from the leading/level side's perspective.
_PRECEDENT_STATES = [
    (0, 0, "level at kickoff"),
    (1, 45, "a goal ahead at half-time"),
    (-1, 45, "a goal behind at half-time"),
    (0, 45, "level at half-time"),
]
_PRECEDENT_MIN_SAMPLE = 50


def _build_precedents(gender: str, states: Optional[dict]):
    if not states:
        return [], None
    out: List[Precedent] = []
    base_rate: Optional[Precedent] = None
    for diff, minute, label in _PRECEDENT_STATES:
        key = f"{gender}:{diff}:{minute}"
        c = states.get(key)
        if not c or int(c.get("n", 0)) < _PRECEDENT_MIN_SAMPLE:
            continue
        prec = Precedent(label=label, n=int(c["n"]), w=int(c["w"]), d=int(c["d"]), l=int(c["l"]))
        if diff == 0 and minute == 0:
            base_rate = prec
        out.append(prec)
    if base_rate is None and out:
        base_rate = out[0]
    return out[:4], base_rate


# --------------------------------------------------------------------------- #
# Prompt construction (used by real providers; FakeProvider reads the grounding
# block these embed)
# --------------------------------------------------------------------------- #

_SYSTEM_PREAMBLE = (
    "You are one of three dissenting football analysts on a panel called The "
    "Boardroom, writing for an educational audience. Voice: sharp, plain, "
    "football-first, never salesy.\n"
    "HARD RULES:\n"
    "- Cite ONLY numbers that appear in the GROUNDING_JSON block. Do not "
    "introduce any other number, not even in passing.\n"
    "- Never name a data source, a model or algorithm, or any internal system. "
    "Never use betting language of any kind (no bets, odds, stakes, bookmakers).\n"
    "- 2-4 sentences of prose. Disagreement with the others is expected and "
    "welcome.\n"
    "- Respond with a single JSON object and nothing else, shaped exactly:\n"
    '  {"stance":"home|draw|away","implied_probs":{"home":0.0,"draw":0.0,'
    '"away":0.0},"text":"...","claims":["..."]}\n'
    "  where implied_probs is YOUR read of the three outcomes (your opinion, it "
    "may differ from the model) and claims are short grounded bullet strings."
)


def boardroom_system_prompt(persona: str) -> str:
    title = PERSONA_TITLES.get(persona, persona)
    mandate = PERSONA_MANDATES.get(persona, "")
    return f"{_SYSTEM_PREAMBLE}\n\nYou are {title}. {mandate}"


def boardroom_user_prompt(bundle: BoardroomBundle, persona: str) -> str:
    payload = json.dumps(bundle.to_prompt_payload(persona), ensure_ascii=False)
    return (
        f"Fixture: {bundle.home_team} vs {bundle.away_team} — {bundle.league}.\n"
        "Write your section of the debate. Ground every number in the block "
        "below.\n\n"
        f"[GROUNDING_JSON]{payload}[/GROUNDING_JSON]"
    )


# --------------------------------------------------------------------------- #
# Parsing persona output
# --------------------------------------------------------------------------- #

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def parse_persona_output(raw: str) -> Optional[dict]:
    """Parse a persona's raw completion into ``{stance, implied_probs, text, claims}``.

    Tolerates a ```json ... ``` code fence and leading/trailing prose. Returns
    ``None`` if no JSON object with a ``text`` field can be recovered.
    """
    if not raw:
        return None
    candidates = [raw]
    fence = _FENCE_RE.search(raw)
    if fence:
        candidates.insert(0, fence.group(1))
    # last-resort: the outermost {...}
    brace = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace:
        candidates.append(brace.group(0))

    for cand in candidates:
        try:
            data = json.loads(cand)
        except (ValueError, TypeError):
            continue
        if not isinstance(data, dict) or "text" not in data:
            continue
        probs = data.get("implied_probs") or {}
        probs = {k: float(probs.get(k, 0.0)) for k in ("home", "draw", "away")}
        s = sum(probs.values())
        if s > 0:
            probs = {k: round(v / s, 4) for k, v in probs.items()}
        claims = data.get("claims") or []
        if not isinstance(claims, list):
            claims = [str(claims)]
        return {
            "stance": str(data.get("stance", "draw")),
            "implied_probs": probs,
            "text": str(data.get("text", "")).strip(),
            "claims": [str(c) for c in claims],
        }
    return None


# --------------------------------------------------------------------------- #
# Dissent index
# --------------------------------------------------------------------------- #


def dissent_index(implied_probs: Sequence[Dict[str, float]]) -> float:
    """Spread of the personas' implied 1X2 views: mean pairwise total-variation.

    For each pair of personas, total-variation distance is
    ``0.5 * sum_o |p_o - q_o|`` over outcomes o ∈ {home, draw, away}; the index
    is the mean over all pairs. It is 0 when everyone agrees exactly and
    approaches 1 as views diverge to disjoint outcomes. Deterministic — computed
    only from the structured ``implied_probs`` fields, never parsed from prose.
    """
    dists = [
        {k: float(p.get(k, 0.0)) for k in ("home", "draw", "away")}
        for p in implied_probs
        if p
    ]
    if len(dists) < 2:
        return 0.0
    total = 0.0
    pairs = 0
    for i in range(len(dists)):
        for j in range(i + 1, len(dists)):
            tv = 0.5 * sum(abs(dists[i][k] - dists[j][k]) for k in ("home", "draw", "away"))
            total += tv
            pairs += 1
    return round(total / pairs, 4) if pairs else 0.0


def dissent_level(index: float) -> str:
    if index >= 0.25:
        return "high"
    if index >= 0.10:
        return "moderate"
    return "low"
