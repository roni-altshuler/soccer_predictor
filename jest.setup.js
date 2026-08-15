// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// testing-library defaults `waitFor` to 1000ms, which is fine for a component
// and tight for a page smoke test: those mount, fire several fetches and
// render a full layout. On an unloaded machine they finish in ~50ms; running
// jest alongside `next build` or `next lint` pushed them past a second and
// suites failed one or two tests at random.
//
// A flaky suite is worse than a slow one — it trains everyone to re-run and
// shrug, which is how a real regression gets waved through. Raised once here
// rather than sprinkled across call sites, so a new test inherits it.
configure({ asyncUtilTimeout: 5000 })

// jsdom doesn't ship IntersectionObserver or ResizeObserver — many UI libs
// (framer-motion's useInView, radix, etc.) reference them on mount.
// Stub no-ops so components mount cleanly in tests.
class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
if (typeof global.IntersectionObserver === 'undefined') {
  // @ts-expect-error -- test-env polyfill
  global.IntersectionObserver = StubObserver
}
if (typeof global.ResizeObserver === 'undefined') {
  // @ts-expect-error -- test-env polyfill
  global.ResizeObserver = StubObserver
}

// jsdom implements no scrolling at all, so `scrollIntoView` is missing from
// Element. Any component that keeps a highlighted row visible in a scrollable
// listbox calls it, and the absence throws rather than no-opping.
if (typeof window !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// jsdom doesn't ship matchMedia either; default to "no-preference" matches.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
