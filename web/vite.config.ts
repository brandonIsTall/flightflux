import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Service worker: precaches the shell, fonts and the land atlas; keeps the last API answers
    // for offline and slow networks. The snapshot itself is also persisted in IndexedDB.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "fonts/*.woff2"],
      manifest: {
        name: "Flight Flux",
        short_name: "Flight Flux",
        description: "Live long-haul flights, colored by the temperature change from departure to arrival.",
        theme_color: "#0B0E13",
        background_color: "#0B0E13",
        display: "standalone",
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg}"],
        maximumFileSizeToCacheInBytes: 3_000_000,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith("/api/snapshot") || url.pathname.endsWith("/fixture/snapshot.json"),
            handler: "NetworkFirst",
            options: { cacheName: "ff-snapshot", networkTimeoutSeconds: 5, expiration: { maxEntries: 2, maxAgeSeconds: 6 * 3600 } },
          },
          {
            urlPattern: ({ url }) => /\/api\/flight\//.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "ff-flight", expiration: { maxEntries: 50, maxAgeSeconds: 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("world-atlas")) return "atlas";
          if (/node_modules\/(three|@react-three|postprocessing|three-stdlib)/.test(id)) return "three";
          return undefined;
        },
      },
    },
  },
});
