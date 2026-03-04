import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Effect, type Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  AcpxSessionLookupService,
  AcpxSessionNotFoundError,
} from "./AcpxSessionLookupService";

const makeFileSystemMock = (
  overrides: Partial<FileSystem.FileSystem>,
): Layer.Layer<FileSystem.FileSystem> => {
  return FileSystem.layerNoop(overrides);
};

const makePathMock = (): Layer.Layer<Path.Path> => {
  return Path.layer;
};

const validSession = (overrides?: Record<string, unknown>) =>
  JSON.stringify({
    schema: "acpx.session.v1",
    acpx_record_id: "rec-001",
    acp_session_id: "acp-sess-001",
    agent_session_id: "agent-sess-001",
    cwd: "/home/user/project",
    closed: false,
    name: "my-session",
    pid: 12345,
    ...overrides,
  });

const runWithLayers = <A, E>(
  effect: Effect.Effect<A, E, AcpxSessionLookupService>,
  fsMock: Layer.Layer<FileSystem.FileSystem>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(AcpxSessionLookupService.Live),
      Effect.provide(fsMock),
      Effect.provide(makePathMock()),
    ),
  );

describe("AcpxSessionLookupService", () => {
  describe("readAllSessions", () => {
    it("returns empty array when sessions directory does not exist", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(false),
      });

      const sessions = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.readAllSessions();
        }),
        fsMock,
      );

      expect(sessions).toEqual([]);
    });

    it("parses valid session files", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["session1.json"]),
        readFileString: () => Effect.succeed(validSession()),
      });

      const sessions = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.readAllSessions();
        }),
        fsMock,
      );

      expect(sessions).toHaveLength(1);
      const first = sessions[0];
      expect(first).toBeDefined();
      expect(first?.acpx_record_id).toBe("rec-001");
      expect(first?.cwd).toBe("/home/user/project");
    });

    it("skips non-json files", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () =>
          Effect.succeed(["session1.json", "readme.txt", "data.csv"]),
        readFileString: () => Effect.succeed(validSession()),
      });

      const sessions = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.readAllSessions();
        }),
        fsMock,
      );

      expect(sessions).toHaveLength(1);
    });

    it("skips files with invalid JSON", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["valid.json", "invalid.json"]),
        readFileString: (filePath: string) => {
          if (filePath.includes("invalid.json")) {
            return Effect.succeed("not valid json{{{");
          }
          return Effect.succeed(validSession());
        },
      });

      const sessions = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.readAllSessions();
        }),
        fsMock,
      );

      expect(sessions).toHaveLength(1);
    });

    it("skips files with wrong schema version", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["wrong.json"]),
        readFileString: () =>
          Effect.succeed(validSession({ schema: "acpx.session.v2" })),
      });

      const sessions = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.readAllSessions();
        }),
        fsMock,
      );

      expect(sessions).toHaveLength(0);
    });

    it("skips files that cannot be read", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["unreadable.json"]),
        readFileString: () =>
          Effect.fail(
            new SystemError({
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: "unreadable.json",
              reason: "Unknown",
              description: "Permission denied",
            }),
          ),
      });

      const sessions = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.readAllSessions();
        }),
        fsMock,
      );

      expect(sessions).toHaveLength(0);
    });

    it("handles sessions without agent_session_id", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["session.json"]),
        readFileString: () =>
          Effect.succeed(
            JSON.stringify({
              schema: "acpx.session.v1",
              acpx_record_id: "rec-002",
              acp_session_id: "acp-sess-002",
              cwd: "/home/user/project",
              closed: false,
            }),
          ),
      });

      const sessions = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.readAllSessions();
        }),
        fsMock,
      );

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.agent_session_id).toBeUndefined();
    });
  });

  describe("findSession", () => {
    it("finds an open session by cwd", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["session.json"]),
        readFileString: () => Effect.succeed(validSession()),
      });

      const session = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.findSession("/home/user/project");
        }),
        fsMock,
      );

      expect(session.acpx_record_id).toBe("rec-001");
    });

    it("finds session by cwd and acp_session_id", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["session.json"]),
        readFileString: () => Effect.succeed(validSession()),
      });

      const session = await runWithLayers(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* service.findSession(
            "/home/user/project",
            "acp-sess-001",
          );
        }),
        fsMock,
      );

      expect(session.acpx_record_id).toBe("rec-001");
    });

    it("fails when no matching session exists", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["session.json"]),
        readFileString: () => Effect.succeed(validSession()),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* Effect.either(service.findSession("/different/path"));
        }).pipe(
          Effect.provide(AcpxSessionLookupService.Live),
          Effect.provide(fsMock),
          Effect.provide(makePathMock()),
        ),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(AcpxSessionNotFoundError);
      }
    });

    it("ignores closed sessions", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["session.json"]),
        readFileString: () => Effect.succeed(validSession({ closed: true })),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* Effect.either(
            service.findSession("/home/user/project"),
          );
        }).pipe(
          Effect.provide(AcpxSessionLookupService.Live),
          Effect.provide(fsMock),
          Effect.provide(makePathMock()),
        ),
      );

      expect(result._tag).toBe("Left");
    });

    it("fails when claudeSessionId does not match", async () => {
      const fsMock = makeFileSystemMock({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(["session.json"]),
        readFileString: () => Effect.succeed(validSession()),
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AcpxSessionLookupService;
          return yield* Effect.either(
            service.findSession("/home/user/project", "wrong-session-id"),
          );
        }).pipe(
          Effect.provide(AcpxSessionLookupService.Live),
          Effect.provide(fsMock),
          Effect.provide(makePathMock()),
        ),
      );

      expect(result._tag).toBe("Left");
    });
  });
});
