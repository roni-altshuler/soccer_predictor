import { createHash } from 'node:crypto'

const tags = new Set('html head body main div span a p h1 h2 h3 h4 script style meta title link select option button input form label section article nav aside header footer ul li svg path dl dt dd'.split(' '))
const components = new Set(['RootLayout', 'ServerRoot', 'ThemeProvider', 'ThemeToggle', 'AuthProvider', 'AppShell', 'TeamComparison', 'MatchEvidence', 'EvaluationPage'])
const phases = new Set('ready loading empty error partial retained recovered recovered-again initial context keyboard keyboard-reload retry held-date held-gender'.split(' '))
const finite = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null
export const nodeType = (value) => tags.has(String(value).toLowerCase()) ? String(value).toLowerCase() : ['#text', '#comment'].includes(value) ? value : null
export function fixtureRoute(value) {
  try {
    if (typeof value !== 'string') return null
    const url = new URL(value, 'http://localhost')
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return null
    const path = url.pathname
    if (['/', '/evaluation', '/leagues'].includes(path)) return path
    if (/^\/matches\/\d+$/.test(path)) return '/matches/:fixture'
    if (/^\/leagues\/(eng|esp|ger|ita|fra|usa)\.1(?:\/(compare|evidence))?$/.test(path)) return path
  } catch { /* Unknown URLs are omitted, including their queries and fragments. */ }
  return null
}
function phase(value) {
  return phases.has(value) || /^(evaluation|projections)-(initial|recovered-partial|retained|recovered)$/.test(value ?? '')
    || /^comparison-cycle-[0-2]$/.test(value ?? '') ? value : null
}
export function runtimeSummary(value = {}) {
  if (!value || typeof value !== 'object') value = {}
  const version = (v, pattern) => typeof v === 'string' && pattern.test(v) ? v : null
  return {
    node: version(value.node, /^v\d+\.\d+\.\d+$/),
    browser: version(value.browser, /^\d+\.\d+\.\d+\.\d+$/),
    next: version(value.next, /^\d+\.\d+\.\d+$/),
    bundledReact: version(value.bundledReact, /^\d+\.\d+\.\d+(?:-canary-[a-f0-9]{8}-\d{8})?$/),
  }
}
function mutationSummary(value) {
  return (Array.isArray(value) ? value : []).slice(-16).map((m) => ({
    elapsedMs: finite(m?.elapsedMs, 1200000),
    kind: ['added', 'removed', 'attribute'].includes(m?.kind) ? m.kind : null,
    target: nodeType(m?.target),
    node: nodeType(m?.node),
    attribute: ['class', 'data-theme', 'data-theme-preference', 'data-ambient', 'content'].includes(m?.attribute) ? m.attribute : null,
  }))
}
function errorCode(event) {
  const message = typeof event?.message === 'string' ? event.message : ''
  if (/React error #418|Hydration failed because/.test(message)) return 'react-hydration-mismatch'
  if (/Timeout \d+ms exceeded|timed out/i.test(message)) return 'timeout'
  return null
}
function elapsed(event) {
  const observed = Date.parse(event?.observedAt), origin = event?.snapshot?.documentTimeOrigin
  return finite(observed - origin, 1200000)
}
function diffNodes(event) {
  const text = [event?.message, ...(Array.isArray(event?.arguments) ? event.arguments : [])].filter((x) => typeof x === 'string').join('\n').slice(0, 32768)
  const nodes = [...text.matchAll(/(?:^|\n)\s*([+-])\s*<([a-z][a-z0-9]*)\b/g)].slice(0, 4)
    .map((m) => ({ side: m[1] === '+' ? 'expected' : 'actual', node: nodeType(m[2]) })).filter((m) => m.node)
  const names = [...text.matchAll(/<([A-Z][A-Za-z]+)\b/g)].map((m) => m[1]).filter((name) => components.has(name))
  return { nodes, components: [...new Set(names)].slice(0, 6) }
}
export function mismatchSummary(e = {}) {
  if (!e || typeof e !== 'object') e = {}
  return {
    route: fixtureRoute(e.route), width: finite(e.width, 2000), height: finite(e.height, 2000),
    page: finite(e.page, 64), document: finite(e.document, 1000),
    elapsedMs: finite(e.elapsedMs, 1200000), expected: nodeType(e.expected), actual: nodeType(e.actual),
    cursorParent: nodeType(e.cursorParent), fiber: [5, 6, 27].includes(e.fiber) ? e.fiber : null,
    ancestry: (Array.isArray(e.ancestry) ? e.ancestry : []).slice(0, 6).map(nodeType).filter(Boolean),
    mutations: mutationSummary(e.mutations), mutationsDropped: finite(e.mutationsDropped, 1000000),
  }
}
export function failureSummary({ bytes, diagnostic, file }) {
  const input = diagnostic && typeof diagnostic === 'object' ? diagnostic : {}
  const browserEvents = Array.isArray(input) ? input : Array.isArray(input.browserEvents) ? input.browserEvents : []
  const captured = Array.isArray(input.mismatches) ? input.mismatches : []
  const errors = browserEvents.filter((e) => errorCode(e)).slice(0, 4).map((e) => ({
    code: errorCode(e), route: fixtureRoute(e.url), elapsedMs: elapsed(e),
    width: finite(e.width, 2000), phase: phase(e.phase ?? e.state),
    document: finite(e.documentRequest?.id, 1000), ...diffNodes(e),
  }))
  const failure = errorCode(input.failure)
  const mismatch = captured.slice(0, 4).map(mismatchSummary)
  return {
    file: /^(record|evidence)-(browser|failed)-(light-|dark-)?(390|768|1440)\.json$/.test(file ?? '') || file === 'ci-hydration-browser.json' ? file : null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    runtime: runtimeSummary(input.runtime),
    capture: ['supported', 'unsupported-renderer', 'unavailable', 'page-limit'].includes(input.capture) ? input.capture : null,
    failure, errors, mismatches: mismatch,
  }
}
