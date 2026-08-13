/**
 * The handbook, addressed from the app.
 *
 * The site used to explain itself in place: every page carried two or three
 * paragraphs on what Brier means, why a walk-forward is honest, what a floor
 * is. Written once each, they were reasonable; read together they were the
 * product — a reader looking for the Champions League bracket had to scroll
 * past a methodology essay to reach it, and the same explanation existed in
 * four slightly different wordings because nothing made them one thing.
 *
 * They are one thing now: `docs/handbook/`, in the repository, and the pages
 * link into it. That is the whole reason this module exists — a single place
 * where a doc's location is written down, so a moved file breaks one line
 * instead of eleven links spread across the app.
 *
 * `src/__tests__/lib/docs.test.ts` asserts every path below resolves to a file
 * that exists on disk. A documentation link that 404s is worse than no link:
 * it is a promise the product visibly fails to keep.
 */

const REPO = 'https://github.com/roni-altshuler/soccer_predictor'
const BRANCH = 'main'

export interface DocEntry {
  /** Repo-relative path. Checked against the filesystem by the test. */
  path: string
  /** How the link reads when it is rendered by title. */
  title: string
  /** One line for a directory listing. */
  blurb: string
}

export const DOCS = {
  handbook: {
    path: 'docs/handbook/README.md',
    title: 'Handbook',
    blurb: 'Everything the site does not say on the page',
  },
  start: {
    path: 'docs/handbook/getting-started.md',
    title: 'Getting started',
    blurb: 'What each page answers, in one screen',
  },
  scoring: {
    path: 'docs/handbook/concepts/scoring.md',
    title: 'Scoring',
    blurb: 'Brier, log loss, ECE, calibration, and the floors every rate is read against',
  },
  models: {
    path: 'docs/handbook/concepts/models.md',
    title: 'Models',
    blurb: 'The four forecasters, and what each was measured against',
  },
  evaluation: {
    path: 'docs/handbook/concepts/evaluation.md',
    title: 'Evaluation',
    blurb: 'Walk-forward against live, and the record that keeps them apart',
  },
  data: {
    path: 'docs/handbook/concepts/data.md',
    title: 'Data',
    blurb: 'Sources, coverage, and what is left genuinely missing',
  },
  glossary: {
    path: 'docs/handbook/glossary.md',
    title: 'Glossary',
    blurb: 'One line per term',
  },
  tutorialMatch: {
    path: 'docs/handbook/tutorials/read-a-match-forecast.md',
    title: 'Read a match forecast',
    blurb: '1X2, the scoreline grid, and what to distrust',
  },
  tutorialSeason: {
    path: 'docs/handbook/tutorials/follow-a-season.md',
    title: 'Follow a season',
    blurb: 'Projected tables, and what their probabilities are a share of',
  },
  tutorialBracket: {
    path: 'docs/handbook/tutorials/read-a-bracket.md',
    title: 'Read a bracket',
    blurb: 'Tie odds, trophy odds, and the seven states an edition can be in',
  },
  tutorialJudge: {
    path: 'docs/handbook/tutorials/judge-the-model.md',
    title: 'Judge the model',
    blurb: 'How to check these claims without taking our word for anything',
  },
  api: {
    path: 'docs/handbook/reference/api.md',
    title: 'HTTP API',
    blurb: 'Every public route, its parameters and its response shape',
  },
  artifacts: {
    path: 'docs/handbook/reference/artifacts.md',
    title: 'Artifacts',
    blurb: 'The JSON files the site is served from, field by field',
  },
  cli: {
    path: 'docs/handbook/reference/cli.md',
    title: 'Commands',
    blurb: 'The scripts that produce those files',
  },
} satisfies Record<string, DocEntry>

export type DocKey = keyof typeof DOCS

/**
 * A link to one document, optionally to a heading inside it.
 *
 * GitHub renders anchors as `#lower-case-hyphenated`, and passing the hash
 * through unchanged is deliberate: the caller writes the anchor GitHub itself
 * generates, rather than this module guessing a slug rule that changes.
 */
export function docsUrl(key: DocKey, hash?: string): string {
  return `${REPO}/blob/${BRANCH}/${DOCS[key].path}${hash ? `#${hash}` : ''}`
}

/** The repository itself — for "read the code" rather than "read the docs". */
export const REPO_URL = REPO
