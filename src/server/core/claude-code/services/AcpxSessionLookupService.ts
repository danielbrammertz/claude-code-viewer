import { homedir } from "node:os";
import { FileSystem, Path } from "@effect/platform";
import { Context, Data, Effect, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { type AcpxSession, acpxSessionSchema } from "../models/AcpxSession";

export class AcpxSessionNotFoundError extends Data.TaggedError(
  "AcpxSessionNotFoundError",
)<{
  message: string;
}> {}

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const sessionsDir = path.join(homedir(), ".acpx", "sessions");

  const readAllSessions = (): Effect.Effect<AcpxSession[]> =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(sessionsDir);
      if (!exists) return [];

      const entries = yield* fs.readDirectory(sessionsDir);
      const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));

      const sessions: AcpxSession[] = [];

      for (const file of jsonFiles) {
        const filePath = path.join(sessionsDir, file);
        const content = yield* Effect.either(
          fs.readFileString(filePath, "utf8"),
        );

        if (content._tag === "Left") continue;

        const parseResult = Effect.try(() => JSON.parse(content.right));
        const parsed = yield* Effect.either(parseResult);

        if (parsed._tag === "Left") continue;

        const validated = acpxSessionSchema.safeParse(parsed.right);
        if (!validated.success) continue;

        sessions.push(validated.data);
      }

      return sessions;
    }).pipe(Effect.catchAll(() => Effect.succeed<AcpxSession[]>([])));

  const findSession = (
    cwd: string,
    claudeSessionId?: string,
    options?: { includeClosed?: boolean },
  ): Effect.Effect<AcpxSession, AcpxSessionNotFoundError> =>
    Effect.gen(function* () {
      const sessions = yield* readAllSessions();
      const resolvedCwd = path.resolve(cwd);

      const match = sessions.find((s) => {
        if (!options?.includeClosed && s.closed) return false;
        if (s.cwd !== resolvedCwd) return false;
        if (
          claudeSessionId !== undefined &&
          s.acp_session_id !== claudeSessionId
        ) {
          return false;
        }
        return true;
      });

      if (match === undefined) {
        const detail =
          claudeSessionId !== undefined
            ? `cwd=${cwd}, claudeSessionId=${claudeSessionId}`
            : `cwd=${cwd}`;
        return yield* Effect.fail(
          new AcpxSessionNotFoundError({
            message: `No acpx session found for ${detail}`,
          }),
        );
      }

      return match;
    });

  /**
   * Reopen a closed acpx session by writing `closed: false` to its JSON file.
   * This allows acpx CLI to find the session and reconnect via loadSession.
   */
  const reopenSession = (session: AcpxSession): Effect.Effect<void> =>
    Effect.gen(function* () {
      const filePath = path.join(sessionsDir, `${session.acpx_record_id}.json`);
      const content = yield* fs.readFileString(filePath, "utf8");
      const data = JSON.parse(content);
      data.closed = false;
      data.closed_at = undefined;
      yield* fs.writeFileString(filePath, JSON.stringify(data, null, 2));
    }).pipe(Effect.catchAll(() => Effect.void));

  return {
    readAllSessions,
    findSession,
    reopenSession,
  };
});

export type IAcpxSessionLookupService = InferEffect<typeof LayerImpl>;

export class AcpxSessionLookupService extends Context.Tag(
  "AcpxSessionLookupService",
)<AcpxSessionLookupService, IAcpxSessionLookupService>() {
  static Live = Layer.effect(this, LayerImpl);
}
