import { Command, Path } from "@effect/platform";
import { Data, Effect } from "effect";
import { uniq } from "es-toolkit";
import { CcvOptionsService } from "../../platform/services/CcvOptionsService";
import * as ClaudeCodeVersion from "./ClaudeCodeVersion";

const npxCacheRegExp = /_npx[/\\].*node_modules[\\/]\.bin/;
const localNodeModulesBinRegExp = new RegExp(
  `${process.cwd()}/node_modules/.bin`,
);

export const claudeCodePathPriority = (path: string): number => {
  if (npxCacheRegExp.test(path)) {
    return 0;
  }

  if (localNodeModulesBinRegExp.test(path)) {
    return 1;
  }

  return 2;
};

class ClaudeCodePathNotFoundError extends Data.TaggedError(
  "ClaudeCodePathNotFoundError",
)<{
  message: string;
}> {}

const resolveClaudeCodePath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const ccvOptionsService = yield* CcvOptionsService;

  // Environment variable (highest priority)
  const specifiedExecutablePath =
    yield* ccvOptionsService.getCcvOptions("executable");
  if (specifiedExecutablePath !== undefined) {
    return path.resolve(specifiedExecutablePath);
  }

  // System PATH lookup
  const claudePaths = yield* Command.string(
    Command.make("which", "-a", "claude").pipe(Command.runInShell(true)),
  ).pipe(
    Effect.map(
      (output) =>
        output
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "") ?? [],
    ),
    Effect.map((paths) =>
      uniq(paths).toSorted((a, b) => {
        const aPriority = claudeCodePathPriority(a);
        const bPriority = claudeCodePathPriority(b);

        if (aPriority < bPriority) {
          return 1;
        }
        if (aPriority > bPriority) {
          return -1;
        }

        return 0;
      }),
    ),
    Effect.catchAll(() => Effect.succeed<string[]>([])),
  );

  const resolvedClaudePath = claudePaths.at(0);

  if (resolvedClaudePath === undefined) {
    return yield* Effect.fail(
      new ClaudeCodePathNotFoundError({
        message: "Claude Code CLI not found in any location",
      }),
    );
  }

  return resolvedClaudePath;
});

const DEFAULT_ACPX_PATH = "/app/extensions/acpx/node_modules/.bin/acpx";

const resolveAcpxPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const ccvOptionsService = yield* CcvOptionsService;

  // CLI option / environment variable (highest priority)
  const specifiedPath =
    yield* ccvOptionsService.getCcvOptions("acpxExecutable");
  if (specifiedPath !== undefined) {
    return path.resolve(specifiedPath);
  }

  // System PATH lookup
  const acpxPaths = yield* Command.string(
    Command.make("which", "-a", "acpx").pipe(Command.runInShell(true)),
  ).pipe(
    Effect.map((output) =>
      output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
    Effect.catchAll(() => Effect.succeed<string[]>([])),
  );

  const resolvedPath = acpxPaths.at(0);
  if (resolvedPath !== undefined) {
    return resolvedPath;
  }

  // Default path
  return DEFAULT_ACPX_PATH;
});

export const Config = Effect.gen(function* () {
  const claudeCodeExecutablePath = yield* resolveClaudeCodePath;

  const claudeCodeVersion = ClaudeCodeVersion.fromCLIString(
    yield* Command.string(Command.make(claudeCodeExecutablePath, "--version")),
  );

  return {
    claudeCodeExecutablePath,
    claudeCodeVersion,
  };
});

export const AcpxConfig = Effect.gen(function* () {
  const acpxExecutablePath = yield* resolveAcpxPath;

  return {
    acpxExecutablePath,
  };
});

export const getMcpListOutput = (projectCwd: string) =>
  Effect.gen(function* () {
    const { claudeCodeExecutablePath } = yield* Config;
    const output = yield* Command.string(
      Command.make(
        "cd",
        projectCwd,
        "&&",
        claudeCodeExecutablePath,
        "mcp",
        "list",
      ).pipe(Command.runInShell(true)),
    );
    return output;
  });

export const getAvailableFeatures = (
  claudeCodeVersion: ClaudeCodeVersion.ClaudeCodeVersion | null,
) => ({
  canUseTool:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 1,
          minor: 0,
          patch: 82,
        })
      : false,
  uuidOnSDKMessage:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 1,
          minor: 0,
          patch: 86,
        })
      : false,
  agentSdk:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 1,
          minor: 0,
          patch: 125,
        })
      : false,
  sidechainSeparation:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 2,
          minor: 0,
          patch: 28,
        })
      : false,
  runSkillsDirectly:
    claudeCodeVersion !== null
      ? ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 2,
          minor: 1,
          patch: 0,
        }) ||
        ClaudeCodeVersion.greaterThanOrEqual(claudeCodeVersion, {
          major: 2,
          minor: 0,
          patch: 77,
        })
      : false,
});

/**
 * Options for executing acpx claude.
 */
export type AcpxExecuteOptions = {
  prompt: string;
  cwd: string;
  sessionName?: string;
  abortController?: AbortController;
};

/**
 * Spawn `acpx claude prompt "<prompt>" --no-wait` and stream NDJSON lines.
 * Each invocation is a NEW subprocess (acpx handles session continuity internally).
 */
export const execute = (options: AcpxExecuteOptions) =>
  Effect.gen(function* () {
    const { acpxExecutablePath } = yield* AcpxConfig;

    const args: string[] = ["claude", "prompt", options.prompt];

    if (options.sessionName) {
      args.push("-s", options.sessionName);
    }

    const command = Command.make(acpxExecutablePath, ...args);

    return {
      command,
      acpxExecutablePath,
      cwd: options.cwd,
      abortController: options.abortController,
    };
  });
