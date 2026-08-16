const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  // MUST stay comfortably above `asyncUtilTimeout` in jest.setup.js (5s).
  //
  // Both default to 5000ms, which puts them in direct conflict: a `waitFor`
  // allowed five seconds sits inside a test allowed five seconds, so it can
  // never spend its budget — the test dies first, and it dies with
  // "Exceeded timeout of 5000 ms for a test" instead of the useful
  // "Unable to find an element with the text ...". Raising asyncUtilTimeout
  // alone (as of 2026-08-15) fixed the symptom on an idle machine and made
  // the failure message worse on a busy one.
  //
  // These are page smoke tests: they mount a full route, fire four fetches and
  // render a complete layout. 15s is slack for a loaded machine, not an
  // expectation — a clean run finishes the whole suite in ~45s.
  testTimeout: 15000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/.venv/',
    '/backend/',
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/__tests__/**',
  ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)
