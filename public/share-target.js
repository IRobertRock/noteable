// Share to Noteable (Android): the installed app is a share target. This runs in
// the service worker, keeps what was shared in a cache, and opens #/shared.
/* global self, caches, Response */
self.addEventListener('fetch', (event) => {
  const scope = new URL(self.registration.scope);
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== `${scope.pathname}share`) return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const cache = await caches.open('noteable-share');
      const meta = { title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''), files: [], at: Date.now() };
      for (const f of form.getAll('files')) {
        if (!f || typeof f === 'string') continue;
        const key = `${scope.pathname}share-file/${meta.at}-${meta.files.length}`;
        await cache.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
        meta.files.push({ key, name: f.name, type: f.type });
      }
      await cache.put(`${scope.pathname}share-meta`, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
      return Response.redirect(`${scope.pathname}#/shared`, 303);
    })(),
  );
});
