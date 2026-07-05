// Screenshot a single route for design iteration.
//   node scripts/shoot_route.mjs /news /tmp/news.png [mobile|tablet|desktop]
// Assumes the app is running (dev or prod) on QA_BASE (default :3000).
import { chromium } from 'playwright'

const [, , route = '/', out = '/tmp/shot.png', vpName = 'desktop'] = process.argv
const BASE = process.env.QA_BASE || 'http://127.0.0.1:3000'
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
}
const viewport = VIEWPORTS[vpName] || VIEWPORTS.desktop

const browser = await chromium.launch()
const page = await browser.newPage({ viewport })
await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
// Dev-mode compiles + data fetches need generous settle time.
await page.waitForTimeout(Number(process.env.QA_SETTLE_MS || 7000))
// Scroll through so whileInView reveals fire before the fullPage capture.
await page.evaluate(async () => {
  const step = window.innerHeight * 0.8
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y)
    await new Promise((r) => setTimeout(r, 120))
  }
  window.scrollTo(0, 0)
})
await page.waitForTimeout(700)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log(`${route} @ ${vpName} -> ${out}`)
