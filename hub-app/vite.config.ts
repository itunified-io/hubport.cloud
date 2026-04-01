import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt" mode: the app controls when to activate the waiting SW
      // (via UpdateBanner + useRegisterSW). This replaces "autoUpdate" so
      // we can push pending changes before applying the update.
      registerType: "prompt",
      includeAssets: ["favicon.ico", "icons/*.png"],
      manifest: false,
      workbox: {
        // config.js is generated at container startup (runtime env injection)
        // — must never be cached by the service worker
        navigateFallbackDenylist: [/^\/config\.js$/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        maximumFileSizeToCacheInBytes: 5_000_000, // 5MB — matrix-js-sdk is large
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) =>
              /\.(?:js|css)$/i.test(url.pathname) &&
              url.pathname !== "/config.js",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-resources",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Cache general API responses but exclude sync and device endpoints
            // (those must always go to the network for data integrity)
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith("/api/") &&
              !url.pathname.startsWith("/api/sync/") &&
              !url.pathname.startsWith("/api/devices/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
});
