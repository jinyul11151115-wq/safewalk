const CACHE_NAME = 'safe-walk-static-v3'
const PRECACHE_URLS = ['/manifest.webmanifest', '/icons/icon-192.svg', '/icons/icon-512.svg']

function cacheKeyFor(url) {
  return new Request(`${url.origin}${url.pathname}`, { method: 'GET' })
}

function isStaticAppRequest(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false
  if (url.pathname.startsWith('/__') || url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/') || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return false
  if (url.hostname.endsWith('openfreemap.org') || url.hostname.endsWith('nominatim.openstreetmap.org')) return false
  return request.mode === 'navigate'
    || ['script', 'style', 'image', 'font', 'manifest', 'worker'].includes(request.destination)
    || url.pathname === '/manifest.webmanifest'
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await cache.addAll(PRECACHE_URLS)
    const pageResponse = await fetch('/')
    if (pageResponse.ok) {
      await cache.put(cacheKeyFor(new URL('/', self.location.origin)), pageResponse.clone())
      const pageHtml = await pageResponse.text()
      const assets = [...pageHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map((match) => new URL(match[1], self.location.origin))
        .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
      const bundles = await Promise.all(assets.map(async (url) => {
        const response = await fetch(url)
        if (!response.ok) return ''
        const copy = response.clone()
        await cache.put(cacheKeyFor(url), copy)
        return url.pathname.endsWith('.js') ? response.text() : ''
      }))
      const workers = new Set(bundles.flatMap((bundle) => [...bundle.matchAll(/(?:\/assets\/)?maplibre-gl-worker-[\w.-]+\.js/g)].map((match) => match[0].startsWith('/') ? match[0] : `/assets/${match[0]}`)))
      await Promise.all([...workers].map(async (path) => {
        const url = new URL(path, self.location.origin)
        const response = await fetch(url)
        if (response.ok) await cache.put(cacheKeyFor(url), response)
      }))
    }
  }).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('safe-walk-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (!isStaticAppRequest(request, url)) return

  const cacheKey = cacheKeyFor(url)
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone()
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)))
    }
    return response
  }).catch(async () => {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(cacheKey)) ?? (request.mode === 'navigate' ? cache.match('/') : Response.error())
  }))
})
