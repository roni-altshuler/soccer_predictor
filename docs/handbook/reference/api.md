# Reference — HTTP API

Every route the site itself uses. They are Next.js route handlers under
`src/app/api/`, served from the same origin as the pages.

**Conventions**

- All responses are JSON, HTTP **200**, including failures.
- Failure is `{"available": false, "reason": "<sentence>"}`. A missing artifact
  is a normal state, not a 500 — the pages render an honest empty state from
  `reason`.
- Artifact-backed routes read committed JSON off disk. FastAPI is not deployed
  on Vercel, so no route here talks to a database.
- Routes that proxy a provider are cached with `revalidate`; artifact routes are
  `force-dynamic`.

---

## Forecasts

### `GET /api/v1/season/projections`

The full season projection artifact.

```jsonc
{
  "available": true,
  "generated_at": "2026-08-13T07:27:43Z",
  "method": { "model_version": "2026.08.1+27734fb2", "sims": 20000, "trained_through": "..." },
  "leagues": [
    {
      "competition_id": "eng.1",
      "name": "Premier League",
      "country": "England",
      "season": 2026,
      "fixtures_remaining": 380,
      "teams": 20,
      "relegation_places": 3,
      "top_cut": 4,
      "top_cut_label": "Champions League",
      "schedule_completeness": 1.0,
      "groups": null,                       // conferences, for grouped leagues
      "qualify_label": null,
      "measured": {                          // this league's own walk-forward
        "n_scored": 8373, "brier": 0.58266, "log_loss": 0.97986,
        "accuracy": 0.53505,
        "uniform": 0.66667, "base_rate": 0.64322, "always_home": 1.08758
      },
      "table": [ /* one row per club, with p_title, p_top_cut, p_relegation, points */ ]
    }
  ]
}
```

`measured` is the block `/evaluation` reads per league. A league with no
measured block renders without a number rather than with a zero.

### `GET /api/v1/season/fixtures`

| param | type | default | meaning |
|---|---|---|---|
| `competition` | string | all | competition id, e.g. `esp.1` |
| `limit` | int | 0 (all) | cap on returned fixtures |

### `GET /api/v1/season/fixture/[uid]`

One fixture: 1X2, expected goals, the scoreline distribution, both Elo ratings.

### `GET /api/v1/tournaments/predictions`

Forward knockout forecasts — the artifact behind `/tournaments`.

```jsonc
{
  "available": true,
  "method": { "states": { "in_progress": "...", "awaiting_fixtures": "..." } },
  "tournaments": [
    {
      "competition_id": "uefa.champions",
      "name": "UEFA Champions League",
      "region": "Europe",
      "season": 2026,
      "status": "awaiting_fixtures",   // see the seven states below
      "is_current": true,
      "reason": "fixtures are published but the knockout draw ...",
      "next_fixture": { "season": 2026, "fixtures": 12, "first_kickoff": "2026-09-16" },
      "bracket": [
        {
          "depth": 3, "display": "Quarter-finals",
          "slots": 4, "projected": false,
          "ties": [
            {
              "team_a": "Arsenal", "team_a_id": 359, "team_b": "Real Madrid", "team_b_id": 86,
              "slot": 0, "pending": true,
              "p_team_a": 0.472, "score": null, "winner_id": null
            }
          ]
        }
      ],
      "odds": [ { "team": "Real Madrid", "team_id": 86, "p": 0.183 } ]
    }
  ]
}
```

**States:** `in_progress`, `upcoming`, `awaiting_fixtures`, `awaiting_draw`,
`completed`, `not_reconstructed`, `insufficient_history`. The last four carry a
`reason` and no `odds`. See
[Read a bracket](../tutorials/read-a-bracket.md#2-the-seven-states).

**Invariants** (enforced by `src/__tests__/lib/tournamentsArtifact.test.ts`
against the artifact on disk, not a fixture):

- exactly one `is_current` edition per competition, and no repeated season
- a tie is priced (`p_team_a`) **or** settled (`score`, `winner_id`), never both
- an edition ahead of the current one is an empty `awaiting_fixtures`
  placeholder backed by a real published fixture list
- slots form a power-of-two ladder down to 1; the tie at slot `s` is fed by
  `2s` and `2s+1`

### `GET /api/v1/tournaments/knockout`

The measured record for the knockout layer: `{ available, ties, brackets }`.
Either half may be `null` — the tie model and the bracket simulation are
separate claims and neither needs the other to be readable.

---

## Evidence

### `GET /api/v1/evaluation`

```jsonc
{
  "available": true,
  "generated_at": "2026-08-13T07:27:43Z",
  "historical": { "basis": "historical_walkforward", "n": 43433, "brier": 0.59303,
                  "log_loss": 0.99379, "accuracy": 0.51788, "ece": 0.00987,
                  "protocol": "...", "competitions": ["eng.1", "..."] },
  "live":       { "basis": "live_published", "n": 0, "note": "..." },
  "join":       { "snapshots": 5041, "scored": 0, "awaiting_result": 4672,
                  "unresolved_count": 379, "unresolved_clubs": { "esp.1:Dep. A Coruña": 38 } },
  "snapshot_store": { "rows": 75663, "fixtures": 5041, "versions": 3, "by_version": { } },
  "warning": "live and historical are different samples ... never add them together"
}
```

Both records carry `basis`. **A consumer that adds them together is reporting a
number that describes nothing**, so the shape deliberately makes it awkward.
When `live.n` is large enough it additionally carries `reliability`,
`baselines`, `by_league` and `by_model_version`.

### `GET /api/v1/tracking/accuracy`

| param | type | default |
|---|---|---|
| `gender` | `men` \| `women` | `men` |

Flat pick record: `winner_accuracy`, `brier_score`,
`expected_calibration_error`, `calibration_bins`, `recent_accuracy`,
`recent_form`, `total_predictions`, `completed_predictions`,
`pending_predictions`, `scope`.

### `GET /api/v1/tracking/accuracy/summary`

Same params, plus per-league rollup in `by_league` keyed by competition id.

### `GET /api/v1/tracking/recent`

| param | type | default |
|---|---|---|
| `gender` | `men` \| `women` | `men` |
| `limit` | int | 20 |
| `completed_only` | bool | `false` |

### `GET /api/v1/accuracy/market` · `/baselines` · `/track-record` · `/projection-calibration`

The committed benchmark artifacts: model against the closing line, the baseline
ladder, per-league records (`?league=<id>` filters), and the season-projection
calibration record.

---

## Football data

### `GET /api/v1/standings`

| param | type | default |
|---|---|---|
| `competition` | string | `eng.1` |
| `season` | int | current |

```jsonc
{ "available": true, "competition": "eng.1", "name": "Premier League",
  "season": 2026, "seasonLabel": "2026-27",
  "seasons": [ { "year": 2026, "label": "2026-27" } ],
  "groups": [ { "name": "Premier League", "teams": [ /* rank, club, played, points, ... */ ] } ] }
```

Groups are preserved rather than flattened, which is what makes one route serve
both a league table and a Champions League league phase. **A season is offered
only once it has started** — ESPN lists a season the moment it is created, so
listing all of them offered a table of twenty zeroes.

### `GET /api/top-scorers/[league]`

| param | type | default |
|---|---|---|
| `season` | int | the season being played |

### `GET /api/todays_matches` · `/api/live_scores` · `/api/match/[id]`

Live football from ESPN. `/api/match/[id]` carries the full detail payload used
by the match page.

### `GET /api/predict/any-teams` · `/predict/head-to-head` · `/predict/cross-league`

Run the model on a matchup that is not on a schedule.

---

## Rate limits and caching

There is no authentication and no published rate limit. Provider-backed routes
revalidate on a short window (300s for standings); artifact-backed routes are
dynamic and cheap. If you are pulling systematically, prefer the artifacts in
[the repository](artifacts.md) over the routes — they are the same data without
the proxy.

## See also

- [Artifacts](artifacts.md) — the files these routes serve
- [Commands](cli.md) — how those files are produced
