/** Observe browser failures without changing the replay's error policy or DOM. */
export function observeBrowserFailures(page, activeContext = () => ({})) {
  const events = [], pending = new Set()
  let documentNavigation = 0, documentRequest = null
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentRequest = { id: ++documentNavigation, url: request.url(), observedAt: new Date().toISOString(), ...activeContext() }
    }
  })
  function record(kind, message, stack, args = []) {
    const event = { kind, message, stack, observedAt: new Date().toISOString(), url: page.url(),
      ...activeContext(), documentRequest, arguments: [], snapshot: null }
    events.push(event)
    // Start the DOM read inside the error handler, before awaiting argument
    // handles or the later assertion timeout. A recovering root may change it.
    const snapshot = page.evaluate(() => ({
        url: location.href,
        documentTimeOrigin: performance.timeOrigin,
        capturedAt: new Date().toISOString(),
        head: document.head?.innerHTML ?? null,
        rootAttributes: Object.fromEntries([...document.documentElement.attributes].map(({ name, value }) => [name, value])),
        themeControls: [...document.querySelectorAll('select[aria-label="Color theme"]')].map((select) => select.value),
        storage: (() => {
          try { return { current: localStorage.getItem('pitchverse-theme'), legacy: localStorage.getItem('theme') } }
          catch { return { unavailable: true } }
        })(),
        osDark: matchMedia('(prefers-color-scheme: dark)').matches,
      })).catch(() => null)
    const task = (async () => {
      event.arguments = await Promise.all(args.map((arg) => arg.evaluate((value) =>
        value instanceof Error ? value.stack : String(value)).catch(() => '<unavailable>')))
      event.snapshot = await snapshot
    })()
    pending.add(task)
    task.finally(() => pending.delete(task))
  }
  page.on('pageerror', (error) => record('pageerror', error.message, error.stack))
  page.on('console', (message) => {
    if (message.type() === 'error') record('console.error', message.text(), undefined, message.args())
  })
  return { async flush() { await Promise.all([...pending]); return events } }
}
