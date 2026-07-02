const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  sw: 'sw.js',
  // Reduce stale client bundles after deploy by avoiding aggressive nav caching.
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  workboxOptions: {
    disableDevLogs: true,
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true,
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'flagcdn.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.fotmob.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'a.espncdn.com',
        pathname: '/**',
      },
    ],
  },
  // Include prediction data files in serverless function bundles
  outputFileTracingIncludes: {
    '/api/v1/tracking/*': ['./backend/data/predictions/**'],
    '/api/v1/ai/*': ['./backend/data/diagnostics/**'],
    '/api/world-cup/*': ['./backend/data/worldcup/**'],
    '/world-cup': ['./backend/data/worldcup/**'],
    '/world-cup/compare': ['./backend/data/worldcup/**'],
  },
}

module.exports = withPWA(nextConfig)