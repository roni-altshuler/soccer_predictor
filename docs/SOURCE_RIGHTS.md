# Source-rights register

Checked **2026-10-05**. This records published source terms and unresolved rights;
it is not legal clearance for the product, models or existing mixed-source corpus.
Free access and public URLs do not establish durable redistribution or commercial
AI/ML rights. No new accounts, keys, paid services or access workarounds were used.

| Source | Verified evidence / rights status | Decision in this change |
| --- | --- | --- |
| OpenFootball football.json | [LICENSE.md at e6744429ee395bc86f247348c6184bb08d4eb361](https://github.com/openfootball/football.json/blob/e6744429ee395bc86f247348c6184bb08d4eb361/LICENSE.md) is **CC0-1.0**; SHA-256 `36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673`. [Pinned README](https://github.com/openfootball/football.json/blob/e6744429ee395bc86f247348c6184bb08d4eb361/README.md) applies the public-domain dedication to schema, data and scripts. CC0 covers the affirmer's copyright/database rights with a fallback license, including commercial purposes. It does not clear trademarks, third-party rights, data accuracy or provenance further upstream. | Only newly sampled/normalized data source. License hash is checked before reading each new source commit. No training or warehouse ingestion. |
| football-data.org (distinct from .co.uk) | [Published terms](https://www.football-data.org/about), sections 2, 7 and 9: registration/API key, single application, visible attribution, and restrictions on continued display after subscription cancellation. Logos/photos require separate consent. The terms describe app/site use; **durable AI/ML training rights are not explicitly established**. | Possible future display source after terms review, attribution and approved account/key setup. No account, key or data ingestion here. |
| FBref / Sports Reference | [Data-use policy](https://www.sports-reference.com/data_use.html) and [terms](https://www.sports-reference.com/termsofuse.html), clause 5, restrict competing/material-substitute services/datastores and use for AI, including ML prediction/classification/scoring. The policy was visible in the primary source's indexed text; direct policy fetch returned 403. No blocking was bypassed. | No ingestion, scraping, training or reuse added. Existing loader/data/model rights remain unresolved and require review; code presence does not establish permission. |
| football-data.co.uk | [Current archive notice](https://www.football-data.co.uk/data.php) limits intended use to private individuals and excludes commercial/data-training products using automated bots/scrapers/AI. Older text elsewhere on the page about match prediction is not a blanket commercial AI grant. | No ingestion or training here. Existing CSV loader/workflow/corpus use needs separate review; this PR does not change schedules or certify those datasets. |
| StatsBomb Open Data (repository now redirects to hudl/open-data) | [Public Data User Agreement](https://github.com/hudl/open-data/blob/master/LICENSE.pdf), read from the public license PDF: sections 1.2.1–1.2.2 restrict redistribution and commercial exploitation of data **or derived analysis**; section 1.4 requires logo credit for published analysis. This is not a general commercial open-data license. | Excluded; no data downloaded or ingested. Only the license was read. |
| ESPN | Existing primary fixture/results/referee/venue feed. No affirmative durable redistribution/commercial ML permission was verified in this change. | Existing production path unchanged. **Unknown rights**, not cleared by OpenFootball's CC0 license. |
| Understat, ClubElo, Open-Meteo and other ancillary/local datasets | Existing loaders/caches/features; their current source-specific terms and the rights/provenance of imported local artifacts were not audited here. | **Unverified**, not cleared. No reads/ingestion/training added. Any future use needs a source-specific review. |

The new adapter's provenance is per source observation; it does not retroactively
license existing rows, clear team logos, or certify models trained on other data.
Read-only policy/license checks above are separate from data ingestion. Operational
remediation of existing restricted/unknown providers is outside this bounded
adapter change and remains for the parent review.
