# Changelog

All notable changes to Pitchverse are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/) once it reaches a 1.0 release.

## [Unreleased]

### Added

- **Brand icon set** generated from the official Pitchverse mark via a reproducible script
  (`scripts/generate-icons.mjs`, `npm run icons`): browser favicons (16/32), `apple-touch-icon`,
  the full maskable PWA icon set, and the 1200×630 OpenGraph / social-preview card.
- **Flagship marketing landing page** at `/welcome` — hero, feature bento, live prediction and
  calibration demos (real backend with static fallback), what-if simulator teaser, and trust
  sections. See [the project memo](docs/REPOSITORY_AUDIT_2026-06-02.md) for context.
- **Repository professionalization**: `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, this
  `CHANGELOG.md`, GitHub issue/PR templates, and a frontend CI workflow
  (`.github/workflows/ci.yml`) running lint, typecheck, build, and tests on every PR.
- `npm run typecheck` (`tsc --noEmit`) and `npm run icons` scripts.

### Changed

- **Rebrand: Pitchwise → Pitchverse.** All user-facing product naming (metadata/SEO,
  PWA manifest, shell wordmark, marketing/about copy, brand SVGs, README/docs) now reads
  Pitchverse. `fotpredict.*` localStorage keys and internal identifiers are intentionally
  unchanged to preserve existing users' preferences.
- **Route structure** split into `(app)` and `(marketing)` route groups so the marketing page can
  drop the `AppShell` chrome while the root layout stays slim and shared. **All existing URLs are
  unchanged** (`/`, `/predict`, `/accuracy`, …).
- Favicon now uses the official logo mark (with the prediction-arc motif).
- Project licensing changed from "all rights reserved" to **MIT** (source code only; trained model
  artifacts and third-party data remain out of scope — see `LICENSE`).

### Fixed

- Broken icon references in document metadata: `favicon-32.png`, `favicon-16.png`,
  `apple-touch-icon.png`, and `brand/og-default.png` were referenced but did not exist (404). They
  are now generated and committed, so browser tab icons, the iOS home-screen icon, and the
  social/link preview card all resolve.

---

_Earlier history predates this changelog. Notable model releases are documented under
[`docs/`](docs/) (e.g. `MODEL_UNIFIED_RELEASE_2026-05-20.md`)._
