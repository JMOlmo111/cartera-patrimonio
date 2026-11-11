/* Service worker · Cartera Patrimonio
   Guarda la "carcasa" de la app para que abra rápido y sin conexión.
   NUNCA guarda las respuestas del servidor (tus datos financieros).
   Estrategia: RED PRIMERO para los archivos de la app (siempre se usa la
   última versión publicada en GitHub) y copia guardada solo si no hay conexión. */
const VERSION = 'cp-v1.1.1';
const CARCASA = [
  './', './index.html', './css/estilos.css', './js/app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CARCASA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== VERSION).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // las llamadas al servidor son POST: no se tocan
  const url = new URL(req.url);
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Librería externa con versión fija: copia guardada primero (no cambia nunca)
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(ca => ca.put(req, copia)); }
      return r;
    })));
    return;
  }
  if (url.origin !== location.origin) return;

  // Archivos de la app: red primero, sin caché del navegador; copia guardada si no hay conexión
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(r => {
      if (r.ok) {
        const copia = r.clone();
        caches.open(VERSION).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, copia));
      }
      return r;
    }).catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req)
      .then(c => c || caches.match('./index.html')))
  );
});