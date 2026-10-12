// Deixa o app abrir sem internet e (quando o navegador permite) liga o modo que acelera o motor.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const CDN = `cdn-${VERSION}`;
const FILES = ['./', 'app.css', 'chunker.js', 'client.js', 'decode.js', 'denoise.js', 'dom.js', 'fft.js', 'gapfill.js', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'index.html', 'job.js', 'main.js', 'manifest.webmanifest', 'mix.js', 'mixer-items.js', 'ort-engine.js', 'player.js', 'restore.js', 'screen-export.js', 'screen-karaoke.js', 'screen-library.js', 'screen-mode.js', 'screen-player.js', 'screen-progress.js', 'screen-voices.js', 'state.js', 'store.js', 'stretch.js', 'tokens.css', 'wav.js', 'worker.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, CDN].includes(k) && k.startsWith('shell-') || k.startsWith('cdn-') && k !== CDN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

function isolate(res) {
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      let res = hit;
      if (!res) {
        try { res = await fetch(req); } catch { return Response.error(); }
      } else {
        // atualiza em segundo plano para a próxima abertura
        fetch(req).then((r) => r.ok && caches.open(SHELL).then((c) => c.put(req, r))).catch(() => {});
      }
      return req.mode === 'navigate' || req.destination === 'worker' || req.destination === 'script' ? isolate(res) : res;
    })());
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(CDN).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
