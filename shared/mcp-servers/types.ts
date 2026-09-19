/**
 * MCP server catalog types — shared between server and client.
 *
 * Entries live in the registered workspace state root below SWARMCREWS_HOME.
 * Swarmcrews owns transport and credentials. Harnesses receive only the
 * fixed connections tool group, never these external server configurations.
 * toolNames is retained as legacy metadata; allowedTools controls access.
 */

import { z } from "zod/v4";

// ── Per-transport entry schemas ─────────────────────────────────────────────

const baseSchema = z.object({
  /** Lower-kebab id: letters, digits, dash, underscore. */
  id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/, {
    message:
      "id must start with a lowercase letter or digit and contain only [a-z0-9_-]",
  }),
  /** Human-readable display name shown in the UI. */
  name: z.string().min(1).max(160),
  /** Optional description shown in the browser panel. */
  description: z.string().max(2000).optional(),
  /** Disabled connections remain saved but cannot be used by any agent. */
  enabled: z.boolean().optional(),
  /** Preselect for new runs. Independent of discovery. */
  isDefault: z.boolean().optional(),
  /** Advertise for on-demand use unless explicitly disabled. */
  selfServe: z.boolean().optional(),
  /** Explicit tool restriction. Omitted means all discovered tools. */
  allowedTools: z.array(z.string().min(1).max(160)).max(256).optional(),
  /** Legacy discovery metadata. Does not grant tool access. */
  toolNames: z.array(z.string().min(1).max(160)).max(256).optional(),
});

const headersSchema = z.record(
  z.string().min(1).max(256).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "invalid HTTP header name"),
  z.string().max(16_384).refine((value) => !/[\r\n]/.test(value), "HTTP header values cannot contain newlines"),
).refine((value) => Object.keys(value).length <= 128, "must contain at most 128 entries");
const envSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "invalid environment variable name"),
  z.string().max(16_384),
).refine((value) => Object.keys(value).length <= 128, "must contain at most 128 entries");

/** Remote MCP credentials and traffic require TLS. Plain HTTP is limited to
 * the local machine for development and process-local sidecars. */
export function isSecureMcpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;
    const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    return match !== null && match.slice(1).every((part) => Number(part) <= 255);
  } catch {
    return false;
  }
}

const secureMcpUrlSchema = z.string().url().max(4096).refine(
  isSecureMcpUrl,
  "remote MCP URLs must use HTTPS; HTTP is allowed only for loopback hosts",
);

export const mcpHttpEntrySchema = baseSchema.extend({
  transport: z.literal("http"),
  url: secureMcpUrlSchema,
  headers: headersSchema.optional(),
  oauth: z.object({ clientId: z.string().max(512).optional(), clientSecret: z.string().max(4096).optional(), scope: z.string().max(2048).optional() }).optional(),
});

export const mcpSseEntrySchema = baseSchema.extend({
  transport: z.literal("sse"),
  url: secureMcpUrlSchema,
  headers: headersSchema.optional(),
  oauth: z.object({ clientId: z.string().max(512).optional(), clientSecret: z.string().max(4096).optional(), scope: z.string().max(2048).optional() }).optional(),
});

export const mcpStdioEntrySchema = baseSchema.extend({
  transport: z.literal("stdio"),
  command: z.string().min(1).max(4096),
  args: z.array(z.string().max(16_384)).max(512).optional(),
  env: envSchema.optional(),
});

/**
 * Discriminated union over all supported transports. The `transport` field
 * is the discriminant; zod picks the right branch automatically.
 */
export const mcpServerEntrySchema = z.discriminatedUnion("transport", [
  mcpHttpEntrySchema,
  mcpSseEntrySchema,
  mcpStdioEntrySchema,
]);

export type McpHttpEntry = z.infer<typeof mcpHttpEntrySchema>;
export type McpSseEntry = z.infer<typeof mcpSseEntrySchema>;
export type McpStdioEntry = z.infer<typeof mcpStdioEntrySchema>;
export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;

// ── Parse helpers ───────────────────────────────────────────────────────────

/** Parse or throw. Use in code paths that have already validated input. */
export function parseMcpServerEntry(value: unknown): McpServerEntry {
  return mcpServerEntrySchema.parse(value);
}

/**
 * Safe parse. Returns the entry or a list of error paths — never throws.
 * Used by the store's list operation to tolerate hand-edited files.
 */
export function safeParseMcpServerEntry(value: unknown):
  | { ok: true; entry: McpServerEntry }
  | { ok: false; errors: { path: string; message: string }[] } {
  const result = mcpServerEntrySchema.safeParse(value);
  if (result.success) return { ok: true, entry: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}
