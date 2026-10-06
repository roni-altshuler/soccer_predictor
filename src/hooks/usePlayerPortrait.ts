'use client'

import { useEffect, useState } from 'react'
import { playerIdentityKey, type PlayerPortrait } from '@/lib/playerPortrait'

/** Display only the verified bytes; stale cached files cannot replace a person. */
export function usePlayerPortrait(entry: PlayerPortrait | undefined, withBase: (path: string) => string) {
  const localPath = entry ? withBase(entry.path) : undefined
  const digest = entry?.sha256
  const key = entry ? `${playerIdentityKey(entry.subject)}|${playerIdentityKey(entry.asset)}|${digest}` : undefined
  const [loaded, setLoaded] = useState<{ key: string; url: string }>()
  useEffect(() => {
    setLoaded(undefined)
    if (!key || !localPath || !digest) return
    let url: URL
    try { url = new URL(localPath, window.location.origin) } catch { return }
    if (url.origin !== window.location.origin) return
    const controller = new AbortController()
    let active = true
    let objectUrl: string | undefined
    void (async () => {
      try {
        const response = await fetch(url.href, { signal: controller.signal })
        if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/webp') return
        const bytes = await response.arrayBuffer()
        const hash = await crypto.subtle.digest('SHA-256', bytes)
        const actual = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        if (!active || actual !== digest) return
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
        setLoaded({ key, url: objectUrl })
      } catch { /* Keep the initials visible when the approved asset is unavailable. */ }
    })()
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, localPath, digest])
  return loaded?.key === key ? loaded?.url : undefined
}
