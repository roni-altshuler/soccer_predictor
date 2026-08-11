// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

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
