# Contributing to Pitchverse

Thanks for your interest in improving Pitchverse. This guide covers the local setup, the
development workflow, and the conventions the project follows so your change lands smoothly.

> Pitchverse is an educational/research project. Please keep contributions aligned with that
> intent — no betting features, and no language that frames the model as betting advice.

## Table of contents

- [Local setup](#local-setup)
- [Project layout](#project-layout)
- [Development workflow](#development-workflow)
- [Branch strategy](#branch-strategy)
- [Commit conventions](#commit-conventions)
- [Quality gates](#quality-gates-run-before-you-push)
- [Pull request expectations](#pull-request-expectations)
- [Coding conventions](#coding-conventions)

## Local setup

**Prerequisites:** Node.js 20+, Python 3.11+, and `npm`.

```bash
# 1. Install JS deps
npm install

# 2. Create the Python venv the dev script expects, and install backend deps
python -m venv .venv
./.venv/bin/pip install -r requirements.txt

# 3. Run both servers (Next.js :3000 + FastAPI :8000)
npm run dev
```

Trained model artifacts (`backend/data/models/*.pt`, scalers, calibrators) are **gitignored** and
not required to run the UI — the app falls back gracefully and the committed prediction JSON under
`backend/data/predictions/` powers the `/accuracy` surfaces. To train locally, see the model
commands in the [README](README.md#train-models).

## Project layout

| Path | What lives here |
|---|---|
| `src/app/(app)/` | Functional product pages (Match Centre, Predict, Accuracy, Simulator, …) wrapped in `AppShell` |
| `src/app/(marketing)/` | Marketing landing (`/welcome`) — no app chrome |
| `src/app/api/` | Node-runtime API routes (proxy ESPN/FotMob, read committed prediction JSON for Vercel) |
| `src/components/` | UI: `ui/` (shadcn), `magicui/`, feature folders, `marketing/` |
| `src/lib/`, `src/hooks/` | Shared utilities and data hooks (`useGenderQuery` is canonical for gender) |
| `backend/` | FastAPI app, ML services, ingestion loaders, CLI scripts, tests |
| `docs/` | Architecture, deployment, model releases, troubleshooting |

See [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md) and the
[repository audit](docs/REPOSITORY_AUDIT_2026-06-02.md) for a deeper map.

## Development workflow

1. Open or comment on an issue describing the change.
2. Branch from `main` (see [branch strategy](#branch-strategy)).
3. Make focused, behavior-preserving commits.
4. Run the [quality gates](#quality-gates-run-before-you-push) locally.
5. Open a PR using the template; link the issue; fill in the testing notes.

## Branch strategy

- `main` is always deployable. The automated prediction pipeline commits to `main` ~3×/day, so
  **rebase feature branches before pushing** to avoid conflicts.
- Long-lived or large work: `feat/<short-description>`.
- Bug fixes: `fix/<short-description>` (small fixes may go straight to `main`).
- Other prefixes: `docs/`, `chore/`, `refactor/`, `ci/`.

## Commit conventions

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <subject>

<body — what & why, not how>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`.

Examples: `feat(web): add flagship marketing landing at /welcome`, `fix(api): guard empty
calibration bins`. Do **not** add AI co-author trailers.

## Quality gates (run before you push)

| Check | Command | Notes |
|---|---|---|
| Lint | `npx next lint` | **Hard gate** — Vercel escalates warnings (`prefer-const`, `no-unused-vars`) to errors |
| Types | `npm run typecheck` | `tsc --noEmit` |
| Build | `npm run build` | Catches type + route errors |
| Unit (FE) | `npm test` | Jest + React Testing Library |
| Unit (BE) | `pytest backend/tests/` | From repo root |
| A11y | `npm run a11y` | axe against a running dev server |

CI runs lint, typecheck, build, and tests on every PR (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Pull request expectations

- Keep PRs focused and reasonably small; logically grouped commits.
- Describe **what** changed and **why**, and how you verified it.
- Update docs/`CHANGELOG.md` when behavior or public surfaces change.
- All CI checks green; no new lint or type errors.
- For UI changes, include before/after screenshots (`npm run shoot`).

## Coding conventions

- **CSS variables over hard-coded colors** — use `text-[var(--text-primary)]`, etc. Hard-coded
  Tailwind grays / `text-white` break light mode (tokens live in `src/app/globals.css`).
- **Server Components by default**; opt into `"use client"` only where interactivity is needed.
- **Data-provenance honesty** — never synthesize match rows or placeholder provider fields; show
  the `DataSourceBadge`.
- **Gender threading** — every data fetch threads `?gender=` via `useGenderQuery`.
- **Backend tests** use absolute imports (`from backend.services...`); the root `conftest.py`
  makes that work without an editable install.
