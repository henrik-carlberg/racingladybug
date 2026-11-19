// Service worker: gör appen installerbar och visar en offlinesida. Inloggade sidor cachas aldrig.
const CACHE = 'bok-v4';
const OFFLINE_RECEIPT = '/kvitto-offline';
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll([OFFLINE, '/icon.svg']);
    // Kvittosidan för läge utan uppkoppling, med sina skript och stilar
    try {
      const r = await fetch(OFFLINE_RECEIPT, { credentials: 'omit' });
      if (r.ok) {
        const html = await r.clone().text();
        await c.put(OFFLINE_RECEIPT, r);
        const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]))];
        await Promise.all(assets.map((a) => c.add(a).catch(() => {})));
      }
    } catch { /* hämtas nästa gång */ }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Delning från andra appar (share target): filen sparas i telefonen och användaren väljer sedan vad den är
function saveShared(file) {
  return new Promise((resolve) => {
    const r = indexedDB.open('bokforing-outbox', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('receipts')) r.result.createObjectStore('receipts', { keyPath: 'id', autoIncrement: true });
      if (!r.result.objectStoreNames.contains('shared')) r.result.createObjectStore('shared');
    };
    r.onsuccess = () => { const t = r.result.transaction('shared', 'readwrite'); t.objectStore('shared').put({ file, name: file.name || 'delad-fil', at: Date.now() }, 'latest'); t.oncomplete = resolve; t.onerror = resolve; };
    r.onerror = resolve;
  });
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u0 = new URL(req.url);
  if (req.method === 'POST' && u0.origin === self.location.origin && u0.pathname === '/dela') {
    e.respondWith((async () => {
      try { const fd = await req.formData(); const f = fd.get('file'); if (f && typeof f !== 'string') await saveShared(f); } catch { /* visa sidan ändå */ }
      return Response.redirect('/dela', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Byggfiler har unika namn och kan cachas
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (req.mode === 'navigate') {
    const receipt = /^\/c\/\d+\/kvitto\/?$/.test(url.pathname);
    e.respondWith(fetch(req).catch(async () => (receipt && (await caches.match(OFFLINE_RECEIPT))) || caches.match(OFFLINE)));
  }
});

// Pushnotiser: visa notisen och öppna rätt sida när man trycker på den
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Bokföring', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Bokföring', { body: d.body || '', tag: d.tag, icon: '/icon.svg', badge: '/icon.svg', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.location.origin));
    if (open) { open.focus(); return open.navigate(url.href); }
    return self.clients.openWindow(url.href);
  }));
});
