import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
