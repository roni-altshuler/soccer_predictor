# Backend asks from the UI agent

Things the frontend now needs that the foreground (ML/backend) stream
should plumb through. Each entry includes the endpoint, the desired
contract, and a sample request/response so the backend side can
implement without round-tripping.

## 1. `gender` query parameter on every prediction-adjacent endpoint

The UI now exposes a Men's ↔ Women's segmented control in the navbar
(`src/components/GenderToggle.tsx`, persisted via
`src/hooks/useGenderPreference.ts`). When the user picks "Women's"
the UI will append `?gender=women` to the relevant API calls. The
default and fallback is `men` (matches today's behaviour).

Affected endpoints (FastAPI handlers under `backend/`):

- `GET /api/todays_matches`            → filter feed by competition gender
- `GET /api/matches_by_date`           → ditto
- `GET /api/upcoming_matches`          → ditto
- `GET /api/predict`                   → route to the appropriate model
- `GET /api/team_form`                 → restrict to single-gender history
- `GET /api/team_stats`                → ditto
- `GET /api/standings`                 → ditto
- `GET /api/leagues`                   → return only leagues for that gender

**Request shape**
```http
GET /api/todays_matches?date=2026-05-20&gender=women
```
**Accepted values**: `men` (default) | `women`.
Unknown values must fall back to `men` silently (the UI guarantees
only those two values, but defensive coding is appreciated).

If the underlying data store does not yet hold women's-league data,
return an empty payload (`{ live: [], upcoming: [], completed: [] }`)
with a `sourceDetail` of `"Women's data not yet ingested"` so the UI
can render the right empty state.

## 2. `/api/og/[matchId]` — UI now owns this route

The UI added `src/app/api/og/[matchId]/route.tsx`, an edge-runtime
route that produces 1200×630 PNG share cards from query parameters
(`?home=&away=&hp=&dp=&ap=&hg=&ag=&league=`). No backend change is
required — this is documented here so the backend agent does not also
add an OG route that conflicts. The frontend should be the source of
truth for share cards because rendering happens at Vercel's edge.

## 3. (Optional) Calibration data for the redesigned accuracy dashboard

The Milestone 5 redesign of `src/components/tracking/AccuracyDashboard.tsx`
is **not yet implemented** in this worktree (the UI agent ran out of
sandbox time — see `UI_AGENT_STATUS.md`). When that lands it will
want, in addition to the existing `/api/tracking/*` payload:

- A calibration vector (bins of predicted probability vs. observed
  outcome rate). Suggested shape:
  ```json
  {
    "calibration": {
      "bins": [
        { "predicted": 0.05, "observed": 0.04, "count": 312 },
        { "predicted": 0.15, "observed": 0.18, "count": 287 },
        ...
      ]
    }
  }
  ```
- A confusion matrix already grouped by outcome class
  (home/draw/away). Suggested shape:
  ```json
  {
    "confusionMatrix": {
      "classes": ["home", "draw", "away"],
      "matrix": [
        [412, 96, 41],
        [78, 132, 89],
        [37, 91, 304]
      ]
    }
  }
  ```

These are nice-to-haves; the UI can derive them locally from a
list of `{ predicted: {h,d,a}, actual: 'h'|'d'|'a' }` rows if the
backend prefers not to compute them server-side.
