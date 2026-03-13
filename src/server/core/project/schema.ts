import { z } from "zod";

export const projectMetaSchema = z.object({
  projectName: z.string().nullable(),
  projectPath: z.string().nullable(),
  /** Original CWD from the JSONL before path resolution (e.g. container-internal path). */
  rawProjectPath: z.string().nullable(),
  sessionCount: z.number(),
});
