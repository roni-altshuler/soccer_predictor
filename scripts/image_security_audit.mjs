// Offline dependency and optimizer assurance; no remote images or exploit payloads.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const nextRequire = createRequire(require.resolve('next/package.json'))
const next = nextRequire('./package.json')
const sharp = nextRequire('sharp')
const sharpPackage = JSON.parse(await readFile(resolve(dirname(nextRequire.resolve('sharp')), '../package.json'), 'utf8'))
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))

function atLeast(version, minimum) {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Require a stable, reviewed dependency release')
  const actual = version.split('.').map(Number)
  for (let index = 0; index < minimum.length; index++) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index]
  }
  return true
}

// These floors come from the official Next.js advisories, not npm's audit count:
// https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2
// https://github.com/advisories/GHSA-2464-fhr4-w9xw
assert.equal(next.version.split('.')[0], '15', 'Review a major Next upgrade separately')
assert.ok(atLeast(next.version, [15, 5, 29]), 'Next must include the SVG rejection fix')
assert.equal(require('eslint-config-next/package.json').version, next.version)
assert.equal(nextRequire('@next/env/package.json').version, next.version)
assert.ok(atLeast(sharpPackage.version, [0, 35, 5]), 'Next must resolve the patched sharp decoder')
assert.equal(sharp.versions.sharp, sharpPackage.version)
assert.equal(nextRequire.resolve('sharp'), require.resolve('sharp'), 'Avoid a hidden older Next decoder')

for (const [path, entry] of Object.entries(lock.packages)) {
  if (/(^|\/)node_modules\/sharp$/.test(path)) {
    assert.ok(atLeast(entry.version, [0, 35, 5]), `Unpatched decoder in ${path}`)
  }
  if (/^node_modules\/(next|eslint-config-next|@next\/(env|eslint-plugin-next|swc-[^/]+))$/.test(path)) {
    assert.equal(entry.version, next.version, `Mismatched Next package in ${path}`)
  }
}
assert.equal(lock.packages['node_modules/next'].version, next.version)
assert.equal(lock.packages['node_modules/sharp'].version, sharpPackage.version)

const { PHASE_PRODUCTION_BUILD } = require('next/constants')
const config = await require('next/dist/server/config').default(PHASE_PRODUCTION_BUILD, root)
assert.equal(config.images.dangerouslyAllowSVG, false)
assert.equal(config.images.unoptimized, false)
assert.deepEqual(config.images.remotePatterns,
  ['flagcdn.com', 'images.fotmob.com', 'a.espncdn.com'].map((hostname) => ({
    protocol: 'https', hostname, port: undefined, pathname: '/**', search: undefined,
  })),
)

const { getSharp, optimizeImage, imageOptimizer, ImageOptimizerCache } = require('next/dist/server/image-optimizer')
assert.equal(getSharp(), sharp, 'Exercise the decoder Next actually uses')
const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#008040' } }).png().toBuffer()
const converted = await optimizeImage({ buffer: png, width: 4, contentType: 'image/webp', quality: 75 })
const metadata = await sharp(converted).metadata()
assert.equal(metadata.format, 'webp')
assert.equal(metadata.width, 4)
assert.equal(metadata.height, 4)

const blocked = ImageOptimizerCache.validateParams(
  { headers: { accept: 'image/webp' } },
  { url: 'https://untrusted.invalid/image.png', w: '16', q: '75' }, config, false,
)
assert.equal(blocked.errorMessage, '"url" parameter is not allowed')
await assert.rejects(
  imageOptimizer(
    { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>'),
      contentType: 'image/svg+xml', cacheControl: null, etag: 'offline-svg' },
    { href: '/offline-probe.svg', width: 16, quality: 75, mimeType: 'image/webp' },
    config, { isDev: false, silent: true },
  ),
  (error) => error.statusCode === 400,
  'SVG inputs must remain rejected by the configured optimizer',
)
console.log(`Image safeguards passed: Next ${next.version}, sharp ${sharpPackage.version}, libvips ${sharp.versions.vips}`)
