import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/v1": "http://localhost:3000" },
  },
});
