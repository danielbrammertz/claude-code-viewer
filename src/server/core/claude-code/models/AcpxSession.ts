import { z } from "zod";

/**
 * Zod schema for acpx session files stored at `~/.acpx/sessions/*.json`.
 * Schema version: "acpx.session.v1"
 */
export const acpxSessionSchema = z.object({
  schema: z.literal("acpx.session.v1"),
  acpx_record_id: z.string(),
  acp_session_id: z.string(),
  agent_session_id: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
  cwd: z.string(),
  closed: z.boolean(),
  name: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
  pid: z.number().optional(),
});

export type AcpxSession = z.infer<typeof acpxSessionSchema>;
