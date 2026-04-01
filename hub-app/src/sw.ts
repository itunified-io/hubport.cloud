/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

// ─── Precache (injected by vite-plugin-pwa at build time) ─────────────

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── Navigation fallback (SPA) ────────────────────────────────────────

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/config\.js$/],
  }),
);

// ─── Runtime Caching ──────────────────────────────────────────────────

// Google Fonts
registerRoute(
  ({ url }) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i.test(url.href),
  new CacheFirst({
    cacheName: "google-fonts",
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

// Images
registerRoute(
  ({ url }) => /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: "images",
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// Static JS/CSS (except runtime config)
registerRoute(
  ({ url }) =>
    /\.(?:js|css)$/i.test(url.pathname) && url.pathname !== "/config.js",
  new StaleWhileRevalidate({
    cacheName: "static-resources",
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// API responses (exclude sync and device endpoints — must always hit network)
registerRoute(
  ({ url }) =>
    url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/api/sync/") &&
    !url.pathname.startsWith("/api/devices/"),
  new NetworkFirst({
    cacheName: "api-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 5 }),
    ],
    networkTimeoutSeconds: 10,
  }),
);

// ─── Push Notifications ───────────────────────────────────────────────

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Hubport", {
      body: data.body ?? "",
      icon: "/icons/icon-192x192.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string | undefined) ?? "/";
  event.waitUntil(self.clients.openWindow(url));
});
