import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web on 4100; API calls proxied to the keeper on 4190 (avoids CORS + hardcoded ports).
// KEEPER_PORT overrides the proxy target for hermetic local verification against a scratch keeper
// instance without touching the default ports (useful when a long-running dev instance already
// owns 4100/4190 — never kill a process you didn't start).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4100,
    strictPort: true,
    proxy: {
      "/api": { target: `http://localhost:${process.env.KEEPER_PORT ?? 4190}`, changeOrigin: true },
    },
  },
});
