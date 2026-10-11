import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fixtureRoute, mismatchSummary, runtimeSummary } from './hydration_failure_summary.mjs'

const require = createRequire(import.meta.url)
const binding = '__pitchverseHydrationMismatch'
export function productionMismatchTarget(source, file) {
  // Next's locked bundled renderer. Unsupported builds retain fatal assertions
  // and explicitly report absent cursor coverage; never guess variable names.
  const match = /var (\w+)=null,(\w+)=null,\w+=!1,\w+=null,\w+=!1,\w+=Error\(\w+\(519\)\);function (\w+)\((\w+)\)\{var \w+=Error\(\w+\(418,/.exec(source)
  if (!match) return null
  const start = match.index + match[0].indexOf(`function ${match[3]}`)
  const offset = source.indexOf('{', start) + 1
  const [, cursor, , fiber] = match.slice(1)
  const expression = `(${binding}(JSON.stringify({route:location.href,width:innerWidth,height:innerHeight,elapsedMs:Math.round(performance.now()),expected:typeof ${fiber}.type==='string'?${fiber}.type:null,actual:${cursor}?.nodeName?.toLowerCase(),cursorParent:${cursor}?.parentNode?.nodeName?.toLowerCase(),fiber:${fiber}.tag,ancestry:(()=>{let a=[],f=${fiber}.return;while(f&&a.length<6){if(typeof f.type==='string')a.push(f.type);f=f.return}return a})(),mutations:window.__pitchverseHydrationMutations?.entries??[],mutationsDropped:window.__pitchverseHydrationMutations?.dropped??0})),false)`
  return { file, lineNumber: source.slice(0, offset).split('\n').length - 1,
    columnNumber: offset - source.lastIndexOf('\n', offset - 1) - 1,
    condition: expression, rendererSha256: createHash('sha256').update(source).digest('hex') }
}
function watchMutations() {
  const record = window.__pitchverseHydrationMutations = { entries: [], dropped: 0 }
  const append = (entry) => {
    if (record.entries.length === 16) { record.entries.shift(); record.dropped++ }
    record.entries.push({ elapsedMs: Math.round(performance.now()), ...entry })
  }
  const start = () => {
    if (!document.head || !document.documentElement) return false
    new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === 'attributes') append({ kind: 'attribute', target: change.target.nodeName.toLowerCase(), attribute: change.attributeName })
        else for (const [kind, nodes] of [['added', change.addedNodes], ['removed', change.removedNodes]]) {
          for (const node of [...nodes].slice(0, 4)) if (node.nodeType === 1) append({ kind, target: 'head', node: node.nodeName.toLowerCase() })
        }
      }
    }).observe(document.head, { childList: true, attributes: true, subtree: true, attributeFilter: ['content'] })
    new MutationObserver((changes) => {
      for (const change of changes) append({ kind: 'attribute', target: 'html', attribute: change.attributeName })
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-theme-preference', 'data-ambient'] })
    return true
  }
  if (!start()) {
    const bootstrap = new MutationObserver(() => { if (start()) bootstrap.disconnect() })
    bootstrap.observe(document, { childList: true, subtree: true })
  }
}
export async function installHydrationDiagnostics(browser, { out, base }) {
  const data = { capture: 'unsupported-renderer', runtime: runtimeSummary({ node: process.version,
    browser: browser.version(), next: require('next/package.json').version,
    bundledReact: require('next/dist/compiled/react').version }), mismatches: [], pages: 0 }
  let target
  for (const file of (await readdir('.next/static/chunks')).filter((f) => /^[\w-]+\.js$/.test(f)).sort()) {
    target = productionMismatchTarget(await readFile(`.next/static/chunks/${file}`, 'utf8'), file)
    if (target) break
  }
  let writes = Promise.resolve()
  const persist = () => { writes = writes.then(() => writeFile(`${out}/ci-hydration-browser.json`, JSON.stringify(data, null, 2))); return writes }
  await persist()
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...args) => {
    const context = await newContext(...args), newPage = context.newPage.bind(context)
    context.newPage = async (...args) => {
      const page = await newPage(...args)
      if (!target) return page
      if (data.pages >= 64) { data.capture = 'page-limit'; await persist(); return page }
      data.pages++
      const pageId = data.pages
      let document = 0
      page.on('request', (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) document++
      })
      try {
        await page.addInitScript(watchMutations)
        const client = await context.newCDPSession(page)
        client.on('Runtime.bindingCalled', (event) => {
          if (event.name !== binding || data.mismatches.length >= 8 || event.payload.length > 8192) return
          try {
            const value = JSON.parse(event.payload)
            if (new URL(page.url()).origin !== new URL(base).origin) return
            const route = fixtureRoute(value.route)
            if (!route) return
            data.mismatches.push(mismatchSummary({ ...value, page: pageId, document }))
            // Retain node evidence if a later CI timeout skips the final log.
            // The raw binding payload never enters stdout.
            if (data.mismatches.length <= 4) console.log(`HYDRATION_CAPTURE ${JSON.stringify({ runtime: data.runtime, mismatch: data.mismatches.at(-1) })}`)
            void persist().catch(() => { data.capture = 'unavailable' })
          } catch { /* Never substitute capture failure for the browser verdict. */ }
        })
        await client.send('Runtime.enable')
        await client.send('Runtime.addBinding', { name: binding })
        await client.send('Debugger.enable')
        await client.send('Debugger.setBreakpointByUrl', { lineNumber: target.lineNumber, columnNumber: target.columnNumber,
          urlRegex: `/_next/static/chunks/${target.file.replaceAll('.', '\\.')}($|\\?)`, condition: target.condition })
        data.capture = 'supported'
        data.rendererSha256 = target.rendererSha256
        await persist()
      } catch {
        data.capture = 'unavailable'
        await persist()
      }
      return page
    }
    return context
  }
  return { async flush() { await writes; return data } }
}
