/** Apply to the UI document as well as API responses. This policy leaves
 * resource loading available for Vite, while preventing clickjacking. */
export const BROWSER_SECURITY_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const;
