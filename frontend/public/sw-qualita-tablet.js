// Service worker minimo — non fa caching, serve solo a soddisfare il requisito di
// Chrome per considerare la PWA "installabile" (serve un fetch handler registrato).
self.addEventListener('fetch', () => {});
