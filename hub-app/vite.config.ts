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
      // injectManifest: use a hand-written SW so we can add push event handlers.
      // The SW source lives at src/sw.ts and includes all workbox routing
      // logic plus the push/notificationclick event handlers.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        maximumFileSizeToCacheInBytes: 5_000_000, // 5MB — matrix-js-sdk is large
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
