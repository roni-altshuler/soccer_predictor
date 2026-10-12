# Static background pixels

Selected pairs from the 48-view production-browser matrix at 390/768/1440px,
in light and dark mode with normal motion enabled. The base is
`48893ef8eca93ba104d3fc8724ffd7807ab19279`; after pixels use the removal's
application source. Provider/image hosts are blocked and committed sparse
fixtures are replayed, so fallback imagery is expected. These images review
background/layout treatment, not live sports-data or provider availability.

| View | Before | After |
|---|---|---|
| Matchday, dark, 390px | [Before](before-dark-390-home.png) | [After](after-dark-390-home.png) |
| Leagues, dark, 1440px | [Before](before-dark-1440-leagues.png) | [After](after-dark-1440-leagues.png) |
| Matchday, light, 390px | [Before](before-light-390-home.png) | [After](after-light-390-home.png) |

Dark pages lose the pitch markings, players, moving light pools and Pitch
controls. Cream light surfaces retain their existing palette. Across all 24
light-view pairs, 19 have identical pixels; the other five differ by 7–80 pixels
(less than 0.02% per view), with the same layout/palette.

[Scope, measurements and reproducible checks](../../STATIC_BACKGROUND_REVIEW.md)
