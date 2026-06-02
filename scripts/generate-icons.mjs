/**
 * Generate the full Pitchwise icon set from the brand SVG sources.
 *
 * Sources (single source of truth, all in public/brand/ + public/):
 *   - public/brand/icon-maskable.svg → full-bleed gradient mark (PWA + apple)
 *   - public/favicon.svg             → rounded-plate mark (browser PNG favicons)
 *   - public/brand/og-default.svg    → 1200×630 social / GitHub preview card
 *
 * Outputs (committed, served as static assets):
 *   - public/icons/icon-{72,96,128,144,152,192,384,512}.png   (manifest, maskable)
 *   - public/favicon-32.png, public/favicon-16.png            (browser tab)
 *   - public/apple-touch-icon.png (180×180)                   (iOS home screen)
 *   - public/brand/og-default.png (1200×630)                  (OpenGraph / Twitter)
 *
 * Run:  node scripts/generate-icons.mjs   (or: npm run icons)
 *
 * Re-run whenever a brand SVG changes so the rasterized assets stay in sync.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const p = (...segs) => path.join(root, ...segs)

const MASKABLE = readFileSync(p('public/brand/icon-maskable.svg'))
const FAVICON = readFileSync(p('public/favicon.svg'))
const OG = readFileSync(p('public/brand/og-default.svg'))

const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

async function render(svg, size, out) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(p(out))
  console.log(`  ✓ ${out} (${size}×${size})`)
}

async function main() {
  console.log('Generating Pitchwise icons…')

  // PWA / maskable icons — full-bleed gradient so platform masks never clip.
  for (const size of PWA_SIZES) {
    await render(MASKABLE, size, `public/icons/icon-${size}x${size}.png`)
  }

  // Browser tab PNG favicons — rounded-plate mark (transparent corners).
  await render(FAVICON, 32, 'public/favicon-32.png')
  await render(FAVICON, 16, 'public/favicon-16.png')

  // iOS home-screen icon — full-bleed (iOS applies its own rounding).
  await render(MASKABLE, 180, 'public/apple-touch-icon.png')

  // OpenGraph / Twitter / GitHub social-preview card.
  await sharp(OG, { density: 192 })
    .resize(1200, 630, { fit: 'contain', background: { r: 7, g: 16, b: 31, alpha: 1 } })
    .png()
    .toFile(p('public/brand/og-default.png'))
  console.log('  ✓ public/brand/og-default.png (1200×630)')

  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
