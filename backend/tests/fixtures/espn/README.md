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

## Postponed La Liga 2 events

[20261107_postponed_scoreboards_excerpt.json](20261107_postponed_scoreboards_excerpt.json)
contains faithful selected fields from the current ESPN scoreboards and summaries
for events `401883142` and `401883122`. Only these events are included; the excerpt
is not a complete schedule. Both sources explicitly report `STATUS_POSTPONED`,
`state: post` and `completed: false`, with no announced roster keys.

The following timestamps are local file-retention times after HTTP 200 responses,
not provider observation timestamps or evidence of pre-kickoff availability.
The hashes and sizes describe the full response bytes retained during diagnosis,
not this excerpt. Test clocks and malformed/scheduled variants are synthetic
regression scenarios and are never written as forecast or provider history.

| Response | Retained at (UTC) | Full bytes | Full SHA-256 |
|---|---|---:|---|
| [scoreboard_20261107](https://site.web.api.espn.com/apis/site/v2/sports/soccer/esp.2/scoreboard?dates=20261107) | 2026-11-07T20:22:02.112433+00:00 | 59381 | `6756751749d26ea09d5f3b73649dc6fa51d27b22b91d7890c01872df2ebdc2c1` |
| [scoreboard_20261108](https://site.web.api.espn.com/apis/site/v2/sports/soccer/esp.2/scoreboard?dates=20261108) | 2026-11-07T20:24:37.922456+00:00 | 44152 | `fc3d48b269966e154365afa69b5a1991df32c58f77faf666da47dfa6c8153df2` |
| [summary_401883142](https://site.web.api.espn.com/apis/site/v2/sports/soccer/esp.2/summary?event=401883142) | 2026-11-07T20:21:25.163872+00:00 | 91654 | `a9834eb7f1a80e78467f0e30ae447a86f438c32019f4bed237c815f3ca43d0c4` |
| [summary_401883122](https://site.web.api.espn.com/apis/site/v2/sports/soccer/esp.2/summary?event=401883122) | 2026-11-07T20:21:57.685300+00:00 | 76265 | `ff3e4d2d23e2ee49bfce7bcd32d9ec4bbd37779d2fea8d813c5cdb5c9d903977` |
