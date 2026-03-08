import { z } from "zod";

/**
 * Zod schemas for acpx NDJSON events (JSON-RPC 2.0 format).
 *
 * acpx emits two kinds of JSON-RPC messages on stdout:
 *  1. Notifications (no `id`): `session/update` with various subtypes
 *  2. Responses (with `id`): either a result or an error
 */

// All session/update notifications share this shape
export const sessionUpdateGenericSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("session/update"),
  params: z.object({
    type: z.string(),
    sessionId: z.string(),
    data: z.record(z.string(), z.unknown()),
  }),
});

export type AcpxSessionUpdateNotification = z.infer<
  typeof sessionUpdateGenericSchema
>;

// --- JSON-RPC result response ---

export const jsonRpcResultSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.object({
    stopReason: z.string().optional(),
  }),
});

export type AcpxJsonRpcResult = z.infer<typeof jsonRpcResultSchema>;

// --- JSON-RPC error response ---

export const jsonRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z
      .object({
        acpxCode: z.string().optional(),
      })
      .optional(),
  }),
});

export type AcpxJsonRpcError = z.infer<typeof jsonRpcErrorSchema>;

// --- Union type for all acpx NDJSON events ---
// Manual discrimination avoids Zod 4 union issues with overlapping `jsonrpc` field

export type AcpxNdjsonEvent =
  | AcpxSessionUpdateNotification
  | AcpxJsonRpcResult
  | AcpxJsonRpcError;

/**
 * Parse raw JSON into a typed AcpxNdjsonEvent.
 * Uses key-presence discrimination instead of z.union to avoid Zod 4
 * issues with overlapping schemas.
 */
export const parseAcpxNdjsonEvent = (
  raw: unknown,
): { success: true; data: AcpxNdjsonEvent } | { success: false } => {
  if (typeof raw !== "object" || raw === null) {
    return { success: false };
  }

  const obj = raw as Record<string, unknown>;

  // Notifications have `method` but no `id`
  if ("method" in obj) {
    const result = sessionUpdateGenericSchema.safeParse(raw);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false };
  }

  // Responses have `id`
  if ("id" in obj) {
    // Error responses have `error`
    if ("error" in obj) {
      const result = jsonRpcErrorSchema.safeParse(raw);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return { success: false };
    }

    // Result responses have `result`
    if ("result" in obj) {
      const result = jsonRpcResultSchema.safeParse(raw);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return { success: false };
    }
  }

  return { success: false };
};
