import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web on 4100; API calls proxied to the keeper on 4190 (avoids CORS + hardcoded ports).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4100,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:4190", changeOrigin: true },
    },
  },
});
