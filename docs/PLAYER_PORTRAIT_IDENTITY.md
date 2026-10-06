# Player portrait identity and profile boundary

## Why this guard exists

The old headshot helper tried one numeric ID against FotMob and then ESPN,
and treated an existing `<id>.webp` file as a cache hit. A numeric ID is scoped
to its provider: `espn:123` and `fotmob:123` can describe different people.
The old avatar component could also guess an ESPN CDN URL directly.

The helper now requires an explicit provider-qualified subject and a reviewed
approval record. The renderer requires the same record plus verified cached
bytes. Missing identity, mapping, permissions, files or matching bytes produce
an accessible initials fallback. A URL on a provider CDN supplies none of the
missing verification or publication permission by itself.

No real portrait permissions or crosswalks are supplied by this change. The
committed `public/headshots/manifest.json` remains empty. Existing assets and
legacy manifest rows are retained; unqualified rows cannot activate portraits.
No provider images were fetched for this PR.

## Approval and cache contract

Approval records are keyed by `provider:id`, with canonical positive decimal
IDs stored as strings. Providers currently recognized by the portrait policy
are `espn` and `fotmob`. Each record requires:

| Field | Required evidence |
| --- | --- |
| `subject` | `{ "provider": "espn", "id": "…" }` matching the requested player |
| `asset` | The actual image provider and its own player ID |
| `subject_verified`, `subject_evidence` | `true` and a nonempty reference documenting the image subject |
| `rights.status`, `rights.evidence` | `permitted` and a nonempty reference documenting permission for this use |
| `source_url` | The exact existing CDN template for the **asset** provider/ID |
| `crosswalk` | When asset and subject identities differ: matching `subject`/`asset`, `verified: true` and evidence |

A crosswalk is also checked when explicitly present for an otherwise matching
identity. Equal digits across providers never create a crosswalk. The evidence
fields are reviewer-supplied attestations; code checks their presence and
consistency, and cannot independently establish image identity or rights.
Do not use the synthetic test evidence as an approval.

The fetch helper accepts an explicit selection and approval file:

```sh
python -m backend.scripts.fetch_player_headshots \
  --ids espn:45843 --approvals /path/to/reviewed-approvals.json
```

This command requires a separately reviewed record; the repository provides
none. Warehouse discovery and unqualified numeric selections have been removed.
`--force` refreshes only approved records. Failed or redirected provider
requests never try another provider or ID. No production workflow invokes a
new fetching path in this PR.

Publication adds `sha256` and a content-addressed local path:
`/headshots/<asset-provider>/<asset-id>-<sha256>.webp`. Cache hits verify the
record and actual bytes. Refreshes create new files without overwriting old
assets; manifest publication is atomic. Malformed manifests fail visibly in
the helper and are preserved. Failed publication leaves the last-good record
and asset usable. Removal from a selection/approval file does not revoke an
already published record: revoke its manifest permission status or remove its
activation record through a separately reviewed change. No asset deletion is
needed. Client manifests refresh on reload; this is not an instant revocation
service for already open pages.

The browser checks the digest of a same-origin local WebP before creating an
image URL. Old responses cannot activate after a subject changes, and object
URLs are revoked. Bare `playerId` and `imageUrl` props remain accepted for
caller compatibility but cannot establish a portrait. Existing ambiguous
lineup callers therefore show initials until qualified identity is threaded
from a verified source.

## Existing profiles and navigation

Saved main at `885127462bf610c9fefa0897f6690dd1e39e2a9e` has a team page and
ESPN-backed player **API** routes, but no frontend player page; team squad names
are plain text. This PR preserves those paths. It does not reactivate legacy
FotMob team/player fetching or build a second profile data source.

The existing player profile and stats URLs continue to accept numeric IDs with
an ESPN default. An explicit `provider=fotmob` is rejected before lookup.
Profile responses validate the athlete ID, include an explicit `identity` and
canonical links, retain league/gender context, and omit unapproved headshot
URLs. Profile/overview cache keys include provider and league context. A
foreign team reference cannot substitute a numeric tail for an ESPN team ID.
Canonical profile and stats URLs accept the same existing default slugs used
for the initial lookup, including `eng.w.1` for `gender=F`. This fixes the
women's default round trip; unrecognized league slugs remain rejected and no
additional women's league coverage is introduced.

The team page rejects another provider namespace in both page and metadata
loading and verifies returned team identity. Its Back control preserves normal
in-app history. For cold links, `returnTo` accepts local Matchday, team or match
paths with their query state; invalid or external destinations fall back to
`/`. Team data still uses the existing ESPN default-league overview; carrying
league/gender in a link is not proof of complete profile coverage in that
context.

## Evidence and remaining scope

The shared Python/TypeScript fixture covers 18 synthetic approval cases,
including colliding IDs, absent mapping, unknown rights, qualified cache paths
and verified crosswalks. Fetch tests mock provider responses and use tiny
generated images only; cache/API/browser-byte tests cover stale and changed
bytes, refresh failures and identity changes. Team tests cover canonical
context, identity rejection and cold versus in-app return behavior.

`npm run test:product` checks accessible initials with both legacy and colliding
manifest records at 390 and 1440 pixels on the existing sparse match-detail
path. All browser provider requests are intercepted. Its `portraitReport` and
cropped screenshots are in the uploaded `product-quality-evidence` CI artifact.
Positive real portrait delivery, real rights/crosswalks and a deep frontend
team-to-player profile experience remain unverified. Those need approved data
and a separate product change. No forecasting, training or serving-model code
changes here.

## Local validation record, October 6, 2026

Implementation commit: `2d0714e3239c1cf269f33589858e8225611bb5e1`, based on
`885127462bf610c9fefa0897f6690dd1e39e2a9e`. The evidence follow-up changes only
this documentation and its retained images/report.

| Check | Measured result |
| --- | --- |
| `npm test -- --runInBand` | 728 passed in 60 suites |
| `.venv/bin/python -m pytest backend/tests -q` | 1,499 passed, 25 skipped, 24 existing warnings |
| `npm run lint` | Passed; no new warnings |
| `npm run typecheck` | Passed |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed |
| `QA_CHROMIUM=/usr/bin/chromium npm run test:product` | Passed against a local production build |

The four portrait cases each recorded zero portrait requests, zero images,
zero avatar accessibility violations, zero overflow and zero browser errors.
The existing 390/768/1440px Matchday/detail/navigation checks also passed.
See the [retained measurements](images/profile-portrait-2026-10-06/report.json),
[390px initials crop](images/profile-portrait-2026-10-06/initials-390.png) and
[1440px initials crop](images/profile-portrait-2026-10-06/initials-1440.png).
The player name/rating/status in the portrait case are synthetic test inputs;
the crop is fallback evidence, not a real player profile or permitted headshot.

## Canonical URL regression follow-up

The initial explicit-slug allowlist omitted the already supported women's
default. A profile loaded with `gender=F` emitted a self URL with
`league=eng.w.1`, which then returned 422. The allowlist now recognizes the
existing gender defaults as well as the existing league mapping values.
Canonical self and stats requests use the same provider, league and normalized
gender as the initial lookup. Unknown slugs and non-ESPN namespaces stay rejected.

The regressions reproduce three failures before the fix and cover six round-trip
contexts plus unknown-slug rejection on both endpoints. After the fix, the
focused player/portrait/client suite passes **63 tests**, and the full backend
suite passes **1,507 tests, with 25 skips and 24 existing warnings**. These tests
mock provider responses and establish URL consistency, not additional women's
data coverage. Frontend code and the retained browser evidence are unchanged
from reviewed head `445346d1bdf3d9a2e939aa0aeefd6f378331974a`.
