// Fork Kaviski (KAVISKI-HUMANOS.md → avisos): service worker SÓ de notificações.
//
// Sem cache e sem `fetch`: a página continua vindo sempre do servidor (atualizar o Voxtrin não depende dele). Serve
// para a notificação ser "do sistema" — no Windows ela vai para a Central de Notificações, no Android/Chrome celular é o
// único jeito de notificar — e para os botões dela (Responder, Deixar entrar...), que só existem por service worker.
//
// A página (client/src/kaviski/humanos/alerts-system.ts) manda {kv: 'show', title, options}; o clique volta para a MESMA
// aba que mostrou (foca e manda {kv: 'notification-click', key, action}); sem aba aberta, abre uma nova.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.kv !== 'show' || typeof msg.title !== 'string') return;
  const options = Object.assign({}, msg.options || {});
  options.data = Object.assign({}, options.data || {}, { client: event.source && event.source.id });
  event.waitUntil(self.registration.showNotification(msg.title, options).catch(() => {}));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const d = n.data || {};
  n.close();
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = (d.client && wins.find((c) => c.id === d.client)) || wins.find((c) => c.focused) || wins[0];
      if (!target) {
        await self.clients.openWindow(d.url || '/');
        return;
      }
      try {
        await target.focus();
      } catch {
        // alguns navegadores só focam com a janela visível
      }
      target.postMessage({ kv: 'notification-click', key: d.key || '', action: event.action || '', page: d.page || '' });
    })(),
  );
});
