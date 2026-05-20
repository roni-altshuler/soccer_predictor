#!/usr/bin/env node
/**
 * Generate static PNG brand assets from the SVG source-of-truth files in
 * /public/brand/. Re-run whenever the SVG logos change.
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Outputs:
 *   public/favicon-16.png          (16x16, from favicon.svg)
 *   public/favicon-32.png          (32x32, from favicon.svg)
 *   public/favicon-192.png         (192x192, from favicon.svg)
 *   public/favicon-512.png         (512x512, from favicon.svg)
 *   public/apple-touch-icon.png    (180x180, from favicon.svg)
 *   public/brand/og-default.png    (1200x630, from public/brand/og-default.svg)
 *
 * Depends on `sharp`. If it is not yet installed, run:
 *   npm install --save-dev sharp
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const publicDir = path.join(root, 'public')

async function main() {
  let sharp
  try {
    ;({ default: sharp } = await import('sharp'))
  } catch (err) {
    console.error('sharp is not installed. Run: npm install --save-dev sharp')
    process.exitCode = 1
    return
  }

  const faviconSvg = await fs.readFile(path.join(publicDir, 'favicon.svg'))
  const ogSvg = await fs.readFile(path.join(publicDir, 'brand', 'og-default.svg'))

  const faviconTargets = [
    { out: 'favicon-16.png', size: 16 },
    { out: 'favicon-32.png', size: 32 },
    { out: 'favicon-192.png', size: 192 },
    { out: 'favicon-512.png', size: 512 },
    { out: 'apple-touch-icon.png', size: 180 },
  ]

  for (const { out, size } of faviconTargets) {
    const dest = path.join(publicDir, out)
    await sharp(faviconSvg).resize(size, size).png({ compressionLevel: 9 }).toFile(dest)
    console.log(`wrote ${path.relative(root, dest)} (${size}x${size})`)
  }

  const ogOut = path.join(publicDir, 'brand', 'og-default.png')
  await sharp(ogSvg, { density: 144 }).resize(1200, 630).png({ compressionLevel: 9 }).toFile(ogOut)
  console.log(`wrote ${path.relative(root, ogOut)} (1200x630)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
