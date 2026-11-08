import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = {
  "Content-Security-Policy": contentSecurityPolicy,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

// React Refresh injects an inline module in development; the header must allow it.
// The production header and the meta tag stay strict.
const devSecurityHeaders = {
  ...securityHeaders,
  "Content-Security-Policy": contentSecurityPolicy.replace(
    "script-src 'self'",
    "script-src 'self' 'unsafe-inline'",
  ),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/v1": "http://localhost:3000" },
    headers: devSecurityHeaders,
  },
  preview: {
    headers: securityHeaders,
  },
});
