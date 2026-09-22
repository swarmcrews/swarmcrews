import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { themeBootstrap } from './build/theme-bootstrap.ts'
import { BROWSER_SECURITY_HEADERS } from './shared/browser-security-headers.ts'

// Front the whole app on the Vite port and forward backend traffic to the
// server. Keeping /api and /ws same-origin means a single HTTPS front (e.g.
// `tailscale serve` terminating TLS on :443) can proxy both the app and the
// socket — which is what gives the mobile PWA the secure context Web Push needs.
const backendPort = process.env["PORT"] ?? "3141"
const apiProxy = {
  // String shorthand enables changeOrigin, breaking the API's Host/Origin
  // equality checks for loopback IPs and Tailscale hosts. Preserve browser Host.
  "/api": { target: `http://localhost:${backendPort}`, changeOrigin: false },
  "/ws": { target: `ws://localhost:${backendPort}`, ws: true },
}

const allowedHosts = [
  ".ts.net",
]

export default defineConfig({
  plugins: [react(), themeBootstrap()],
  server: {
    host: "127.0.0.1",
    headers: BROWSER_SECURITY_HEADERS,
    allowedHosts,
    proxy: apiProxy,
    watch: {
      // Ignore sidecar data and worktree directories so that autosave DB writes,
      // settings changes, and worktree operations don't trigger Vite full-reloads.
      ignored: [
        "**/.minions/**",
        "**/.swarmcrews/**",
        "**/.canvas-worktrees/**",
      ],
    },
  },
  preview: {
    host: "127.0.0.1",
    headers: BROWSER_SECURITY_HEADERS,
    allowedHosts,
    proxy: apiProxy,
  },
})
