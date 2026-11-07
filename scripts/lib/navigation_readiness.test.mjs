// Harness contracts only: these DOM labels contain no model or result fixtures.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { matchdaySnapshot } from './navigation_race_checks.mjs'

const expected = { url: '/?date=2026-09-19&competition=Premier+League&filter=upcoming', date: 'Yesterday', status: 'To play', competition: 'Premier League' }
const defaults = { date: 'Today', status: 'All matches', competition: 'All competitions' }
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined }) })
after(async () => { await browser?.close() })

async function pageWith(view, url = expected.url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Filter readiness contract</title><main></main>' }))
  await page.goto(`http://matchday.test${url}`, { waitUntil: 'networkidle' })
  await setView(page, view)
  return { page, context }
}

async function setView(page, view) {
  await page.evaluate(view => {
    const group = (label, text) => `<div aria-label="${label}"><button aria-pressed="true">${text}</button></div>`
    document.querySelector('main').innerHTML = group('Select date', view.date) + group('Filter matches', `${view.status} 4`) + group('Filter by competition', `${view.competition} 4`)
  }, view)
}

test('waits for URL controls that initialize after network idle', async () => {
  const { page, context } = await pageWith(defaults)
  try {
    assert.equal(await page.locator('[aria-label="Select date"] button').innerText(), 'Today')
    await page.evaluate(view => {
      setTimeout(() => {
        const groups = ['Select date', 'Filter matches', 'Filter by competition']
        for (const [index, text] of [view.date, `${view.status} 4`, `${view.competition} 4`].entries()) {
          document.querySelector(`[aria-label="${groups[index]}"] button`).textContent = text
        }
      }, 400)
    }, expected)
    assert.deepEqual(await matchdaySnapshot(page, expected), expected)
  } finally { await context.close() }
})

test('rejects controls that remain wrong after the existing readiness deadline', async () => {
  const { page, context } = await pageWith(defaults)
  try {
    await assert.rejects(matchdaySnapshot(page, expected), error => error.name === 'TimeoutError')
  } finally { await context.close() }
})

test('rejects a wrong URL even when all selected controls match', async () => {
  const { page, context } = await pageWith(expected, '/?date=2026-09-18')
  try {
    await assert.rejects(matchdaySnapshot(page, expected), error => error.name === 'TimeoutError')
  } finally { await context.close() }
})
