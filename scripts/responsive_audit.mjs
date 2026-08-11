// Responsive + tap-target audit against real device profiles.
//
//   node scripts/responsive_audit.mjs                      # all routes
//   node scripts/responsive_audit.mjs /season              # one route
//
// Checking breakpoints by reading Tailwind classes is not the same as looking
// at a phone. This drives Playwright's real device descriptors — viewport,
// device pixel ratio, touch, and user agent together — and asserts the two
// things that actually break at 375px and cannot be seen in a unit test:
//
//   1. HORIZONTAL OVERFLOW. A page that scrolls sideways hides the column a
//      reader navigates by. Wide content is allowed to scroll, but only inside
//      its own container: an element wider than the viewport is a failure
//      unless an ancestor is overflow-x auto/scroll.
//   2. TAP TARGETS. A 14px control is operable with a mouse and not with a
//      thumb. Anything interactive under 24px in either dimension is reported.
//
// Exits non-zero on a failure, so it can gate a change rather than just
// produce pictures.
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3000'
const OUT = process.env.QA_OUT || 'scripts/screenshots/responsive'

// One genuinely small phone, one ordinary one, a tablet at the md boundary,
// and a laptop. 375 is the width that matters: it is the iPhone SE and the
// narrowest device still in wide use.
const PROFILES = [
  // Playwright's "iPhone SE" descriptor is the 1st-gen 320px device. Keep it —
  // narrower is a stronger test — but 375 is the width to design to, so it
  // gets its own profile rather than being assumed covered.
  { name: 'narrow-320', device: devices['iPhone SE'] },
  {
    name: 'iphone-se-375',
    device: {
      ...devices['iPhone SE'],
      viewport: { width: 375, height: 667 },
      screen: { width: 375, height: 667 },
    },
  },
  { name: 'iphone-12-390', device: devices['iPhone 12'] },
  { name: 'ipad-mini-768', device: devices['iPad Mini'] },
  { name: 'laptop-1440', device: { viewport: { width: 1440, height: 900 } } },
]

const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/season', '/evaluation']

const MIN_TAP = 24

async function audit(page, route, profile) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(Number(process.env.QA_SETTLE_MS || 4000))

  const findings = await page.evaluate((minTap) => {
    const vw = document.documentElement.clientWidth
    const out = { vw, pageScrollWidth: document.documentElement.scrollWidth,
                  overflow: [], small: [] }

    const scrollsHorizontally = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX
        if (ox === 'auto' || ox === 'scroll') return true
      }
      return false
    }
    const describe = (el) =>
      el.tagName.toLowerCase() +
      (el.id ? `#${el.id}` : '') +
      (el.className && typeof el.className === 'string'
        ? `.${el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`
        : '')

    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (getComputedStyle(el).position === 'fixed') continue
      if (r.right > vw + 1 && !scrollsHorizontally(el)) {
        out.overflow.push({ el: describe(el), right: Math.round(r.right) })
      }
    }

    for (const el of document.querySelectorAll(
      'a[href], button, [role="option"], [role="tab"], input, select, summary')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      // Skip-links are 1x1 until focused, when they are full size.
      if (el.classList.contains('sr-only')) continue
      // WCAG 2.5.8 exempts a link inside a sentence of running text: it cannot
      // be enlarged without breaking the line it sits in.
      if (cs.display === 'inline' && el.closest('p')) continue
      if (r.width < minTap || r.height < minTap) {
        out.small.push({
          el: describe(el),
          text: (el.textContent || '').trim().slice(0, 30),
          w: Math.round(r.width), h: Math.round(r.height),
        })
      }
    }
    // Dedupe by selector so one repeated row is one finding.
    const uniq = (list, key) => {
      const seen = new Map()
      for (const f of list) if (!seen.has(f[key])) seen.set(f[key], f)
      return [...seen.values()]
    }
    out.overflow = uniq(out.overflow, 'el').slice(0, 10)
    out.small = uniq(out.small, 'el').slice(0, 10)
    return out
  }, MIN_TAP)

  const slug = route.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'root'
  await page.screenshot({ path: `${OUT}/${slug}--${profile}.png`, fullPage: true })
  return findings
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
let failures = 0

for (const { name, device } of PROFILES) {
  const context = await browser.newContext(device)
  const page = await context.newPage()

  for (const route of ROUTES) {
    const f = await audit(page, route, name)
    const scrolls = f.pageScrollWidth > f.vw + 1
    const bad = scrolls || f.overflow.length
    if (bad) failures++
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${name.padEnd(15)} ${route.padEnd(12)} ` +
        `vw=${f.vw} scrollWidth=${f.pageScrollWidth} ` +
        `overflow=${f.overflow.length} smallTargets=${f.small.length}`,
    )
    for (const o of f.overflow) console.log(`        overflows: ${o.el} -> ${o.right}px`)
    for (const s of f.small)
      console.log(`        small tap: ${s.el} ${s.w}x${s.h} "${s.text}"`)

    // The league picker is the one control that changes what the whole page
    // shows, and it is the piece most likely to overflow: it is the widest
    // thing on the page when open.
    if (route === '/season') {
      const trigger = page.locator('button[aria-haspopup="listbox"]').first()
      if (await trigger.count()) {
        await trigger.click()
        await page.waitForTimeout(250)
        const open = await page.evaluate(() => {
          const list = document.querySelector('[role="listbox"]')
          if (!list) return null
          const r = list.getBoundingClientRect()
          // The bottom tab bar is fixed; a panel that runs under it is
          // truncated with no scrollbar and no sign the rest exists.
          const bars = [...document.querySelectorAll('nav, footer')]
            .filter((n) => getComputedStyle(n).position === 'fixed')
            .map((n) => n.getBoundingClientRect())
          const floor = bars.reduce(
            (min, b) => (b.top > r.top ? Math.min(min, b.top) : min),
            window.innerHeight,
          )
          return {
            vw: document.documentElement.clientWidth,
            right: Math.round(r.right), left: Math.round(r.left),
            top: Math.round(r.top), bottom: Math.round(r.bottom),
            floor: Math.round(floor),
            height: Math.round(r.height),
            options: document.querySelectorAll('[role="option"]').length,
          }
        })
        if (!open) {
          console.log('        FAIL  league picker did not open')
          failures++
        } else {
          const fits =
            open.left >= -1 &&
            open.right <= open.vw + 1 &&
            open.top >= -1 &&
            open.bottom <= open.floor + 1
          if (!fits) failures++
          console.log(
            `        ${fits ? 'ok  ' : 'FAIL'}  picker open: ${open.options} options, ` +
              `x ${open.left}..${open.right} of ${open.vw}, ` +
              `y ${open.top}..${open.bottom} under obstruction at ${open.floor}, ` +
              `${open.height}px tall`,
          )
          await page.screenshot({ path: `${OUT}/season-picker--${name}.png` })
        }
        await page.keyboard.press('Escape')
      }
    }
  }
  await context.close()
}

await browser.close()
console.log(failures ? `\n${failures} failure(s)` : '\nno layout failures')
process.exit(failures ? 1 : 0)
