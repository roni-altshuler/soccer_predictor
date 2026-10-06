# Legacy injury league routing

## Evidence and scope

[Normal scheduled run 37541467094](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37541467094)
on main `e63649f2271fd7d184b1d019bc75b1d4fe34aa7d` verified PR37's failed-run
diagnostic retention: injury refresh failed, data commit/cache save were
skipped, and artifact upload succeeded. Independent review of
[artifact 11448621017](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37541467094/artifacts/11448621017)
reports 42 sanitized records: 40 `missing_injury_content` and two HTTP 502
errors. Both `eng.1` attempts lacked injury content. This establishes metadata
retention, not provider recovery or valid empty injury reports.

The two legacy observations, ESPN teams 364 and 360, have no league key.
Previously each lookup tried all 21 configured league paths. The current
repository provides a unique identity binding for each in
[`sim_priors.json` at the reviewed source commit](https://github.com/roni-altshuler/soccer_predictor/blob/e63649f2271fd7d184b1d019bc75b1d4fe34aa7d/backend/data/sim_priors.json):

| Provider | Team ID | Club | League key | ESPN slug |
| --- | --- | --- | --- | --- |
| ESPN | 364 | Liverpool | `premier_league` | `eng.1` |
| ESPN | 360 | Manchester United | `premier_league` | `eng.1` |

The source was generated `2026-10-04T14:23:23+00:00`; its SHA-256 is
`f0db5a90013400f57e1f244acea7148d41c96a1fad4679f1c346f8a8eaaa1659`.
The [builder](https://github.com/roni-altshuler/soccer_predictor/blob/e63649f2271fd7d184b1d019bc75b1d4fe34aa7d/backend/scripts/build_sim_priors.py)
reads ESPN standings `team.id`/`displayName` and exports `espn_team_id` and
`espn_league_slug`. Only those identity fields were extracted into
[`injury_team_routes.json`](../backend/data/injury_team_routes.json), with
source commit/path/hash/time and builder provenance. No strength, prior,
prediction or numerical model value participates in routing. The runtime
reads this small manifest using standard JSON; it does not import the builder
or depend on model execution or the current model artifact.

## Routing contract

For an ESPN refresh, valid caller-supplied league context takes priority,
followed by existing same-provider cached context. Only absent/null context
uses the manifest. Explicit empty, non-string or unsupported context is
unavailable; it is not silently replaced. Provider team IDs must be canonical
positive numeric strings. Fresh observation reads retain their existing cache
behavior; this change governs provider refresh routing.
Stale cache records must explicitly identify their provider; no missing source
defaults to ESPN. A supplied cached team ID must match its observation filename
and cannot silently redirect a refresh to another team's cache.

A legacy lookup requires exactly one binding for the provider/team pair.
Missing, duplicate/conflicting, malformed or unsupported bindings make zero
provider requests. Duplicate JSON keys and missing/invalid provenance also
fail closed. The league key must be configured and its slug must agree with
the existing ESPN mapping. No team-name inference, guessed numeric IDs,
all-league probing, new endpoint or cross-provider fallback is used. A FotMob
ID with the same number cannot select an ESPN binding; explicitly selected
FotMob behavior stays unchanged.

Routing failure uses `invalid_context` plus allowlisted details:
`missing_league_mapping`, `conflicting_league_mapping`,
`unsupported_league_mapping`, `invalid_routing_evidence` or
`invalid_team_identity` or `unknown_provider`. Diagnostic records retain their bounded, sanitized
fields; manifest names, error text and provider payloads are not copied into
them. Existing explicit-context validation retains `unknown_league`.

Each resolved legacy team uses its existing endpoint once:
`eng.1/teams/364/injuries` or `eng.1/teams/360/injuries`. Missing content still
raises `ProviderUnavailable`. Failure preserves last-good observation bytes,
mtime and `fetched_at`; routing never rewrites a cache just to add league
metadata. Only an existing valid report success may establish a new observation
and save its resolved context. Injury CLI failures remain nonzero, and the
workflow's success-only publication gate is unchanged.

## Offline verification and limits

The two-team mocked CLI replay reads its actual on-disk output, both with normal
checkpoints and with checkpoints disabled to isolate final export. Each run
makes **two requests rather than the former 42**, retains two
`missing_injury_content` records, exits 1 and preserves both caches. It makes
zero FotMob calls. This is a request-scope result from deterministic mocks,
not a live post-change provider observation.

Tests also cover mapping conflicts/duplicates/unknowns, corrupt/missing
manifests, unsupported/invalid explicit context, exact paths, provider namespace
isolation, cache preservation, safe diagnostics, strict publication gates and
lookup with numerical/prediction imports blocked. Repository identity audits
verify that the two configured bindings remain unique in the current committed
identity evidence. The [measured replay summary](fixtures/injury-diagnostics/legacy_routing_mock_summary.json)
records the local results and test source hashes.

| Local check | Result |
| --- | --- |
| Focused routing/diagnostic/scraper/client suite | 158 passed; 3 existing warnings |
| Full backend suite | 1,579 passed; 25 skipped; 24 existing warnings |
| Unchanged workflow YAML and four shell steps (`bash -n`) | Passed |
| Removed/empty CLI export, isolated mutation checks | Two expected test failures per mutation |

```sh
python -m pytest backend/tests/test_injury_routing.py \
  backend/tests/test_injury_diagnostics.py backend/tests/test_scraper_failures.py \
  backend/tests/test_espn_client.py -q
python -m pytest backend/tests/ -q
```

Only these two legacy bindings have been reviewed. New teams, changed league
membership or a new identity snapshot require deliberate revalidation and a
manifest update; the snapshot date is not an injury observation time. Provider
recovery, injury coverage and production request reduction remain unverified.
No live provider request, workflow dispatch, new ingestion, model work or
frontend/API response change was performed for this patch.
