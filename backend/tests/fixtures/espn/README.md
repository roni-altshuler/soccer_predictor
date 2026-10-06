# ESPN scheduled-event excerpt

[761660_scheduled_excerpt.json](761660_scheduled_excerpt.json) is a faithful
selected-field excerpt supplied by the independent reviewer from a retained
ESPN response. It is **not the full capture**. The reviewer states that every
field used by the missing-roster parser path is included. Both identified
roster sides deliberately have no `roster` key; the event is explicitly
scheduled and incomplete.

Reviewer-reported original full-response provenance:

| Field | Value |
|---|---|
| Source | [ESPN MLS event 761660 summary](https://site.web.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event=761660) |
| Captured at | 2026-10-06 05:47:01 UTC |
| HTTP status | 200 |
| Content type | `application/json` |
| Request headers | The scraper's exact headers, as reported by the reviewer; header values were not supplied with the excerpt |
| Original response size | 194,751 bytes |
| Original response SHA-256 | `4f6f27e50c003addfb40baf2f3329b415a627124305616e294404f69a4101d8b` |

The hash and byte count describe the original full response, **not this JSON
excerpt**. The full bytes are not stored here and were not rehashed in this
environment. No new provider request was made. Offline tests replay this
excerpt through the parser and public fetch/cache path; malformed roster
variants are deliberate test mutations, not additional captured observations.
