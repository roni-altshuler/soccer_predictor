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
