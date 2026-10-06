/** Only known in-app profile parents may supply a cold-link return path. */
export function profileReturnHref(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/'
  try {
    const url = new URL(value, 'https://pitchverse.invalid')
    if (url.origin !== 'https://pitchverse.invalid' || url.hash
      || !(/^\/$/.test(url.pathname) || /^\/(?:teams|matches)\/[1-9][0-9]*$/.test(url.pathname))) return '/'
    return `${url.pathname}${url.search}`
  } catch { return '/' }
}
