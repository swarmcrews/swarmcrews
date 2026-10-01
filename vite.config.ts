import { createReadStream, existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createBrotliCompress, createGzip } from 'node:zlib'
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

// Vite preview's built-in static server does not negotiate compression. Only
// content-hashed, text-based build assets receive immutable caching and streaming
// compression; HTML, API, WS and unversioned public assets retain default policy.
function productionAssets() {
  return {
    name: 'swarmcrews-production-assets',
    configurePreviewServer(server: { middlewares: { use: (handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void) => void }; config: { root: string; build: { outDir: string } } }) {
      const dist = resolve(server.config.root, server.config.build.outDir)
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? ''
        if (!['GET', 'HEAD'].includes(req.method ?? '') || !/^\/assets\/[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{8,}\.(js|css|svg|json)$/.test(pathname)) return next()
        const file = resolve(dist, '.' + pathname)
        if (!file.startsWith(dist + sep) || !existsSync(file)) return next()
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.setHeader('Vary', 'Accept-Encoding')
        if (req.headers.range) return next()
        const accepted = req.headers['accept-encoding'] ?? ''
        const encoding = /(?:^|,)\s*br(?:\s*;\s*q=(?!0(?:\.0*)?(?:,|$))[^,]+)?(?:,|$)/i.test(accepted) ? 'br'
          : /(?:^|,)\s*gzip(?:\s*;\s*q=(?!0(?:\.0*)?(?:,|$))[^,]+)?(?:,|$)/i.test(accepted) ? 'gzip' : null
        if (!encoding) return next()
        const extension = pathname.slice(pathname.lastIndexOf('.') + 1)
        res.setHeader('Content-Type', { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', json: 'application/json' }[extension]!)
        for (const [name, value] of Object.entries(BROWSER_SECURITY_HEADERS)) res.setHeader(name, value)
        res.setHeader('Content-Encoding', encoding)
        if (req.method === 'HEAD') { res.end(); return }
        createReadStream(file).on('error', () => { if (!res.headersSent) res.statusCode = 500; res.end() })
          .pipe(encoding === 'br' ? createBrotliCompress() : createGzip()).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), themeBootstrap(), productionAssets()],
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
