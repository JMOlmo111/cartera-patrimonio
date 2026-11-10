/* Service worker · Cartera Patrimonio
   Guarda la "carcasa" de la app para que abra rápido y sin conexión.
   NUNCA guarda las respuestas del servidor (tus datos financieros). */
const VERSION = 'cp-v1.0.0';
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
  // Red primero para la página (coge actualizaciones); caché si no hay conexión
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      const copia = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copia)); return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // Caché primero para archivos estáticos
  e.respondWith(caches.match(req).then(enCache => enCache || fetch(req).then(r => {
    if (r.ok && (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com')) {
      const copia = r.clone(); caches.open(VERSION).then(c => c.put(req, copia));
    }
    return r;
  })));
});
