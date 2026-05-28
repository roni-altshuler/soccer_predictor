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
