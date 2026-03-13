import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Path } from "@effect/platform";
import { Effect, Context as EffectContext, Layer } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { CcvOptionsService } from "./CcvOptionsService";

export type ClaudeCodePaths = {
  globalClaudeDirectoryPath: string;
  claudeCommandsDirPath: string;
  claudeSkillsDirPath: string;
  claudeProjectsDirPath: string;
};

/**
 * Recursively discover all `.claude/projects/` directories under a root,
 * up to maxDepth levels deep.
 */
const discoverClaudeProjectsDirs = (
  root: string,
  maxDepth: number,
): string[] => {
  const results: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      if (entry === ".claude") {
        const projectsDir = join(full, "projects");
        if (existsSync(projectsDir)) {
          results.push(projectsDir);
        }
      } else {
        walk(full, depth + 1);
      }
    }
  };

  walk(root, 0);
  return results;
};

const LayerImpl = Effect.gen(function* () {
  const path = yield* Path.Path;
  const ccvOptionsService = yield* CcvOptionsService;

  const claudeCodePaths = Effect.gen(function* () {
    const globalClaudeDirectoryPath = yield* ccvOptionsService
      .getCcvOptions("claudeDir")
      .pipe(
        Effect.map((envVar) =>
          envVar === undefined
            ? path.resolve(homedir(), ".claude")
            : path.resolve(envVar),
        ),
      );

    return {
      globalClaudeDirectoryPath,
      claudeCommandsDirPath: path.resolve(
        globalClaudeDirectoryPath,
        "commands",
      ),
      claudeSkillsDirPath: path.resolve(globalClaudeDirectoryPath, "skills"),
      claudeProjectsDirPath: path.resolve(
        globalClaudeDirectoryPath,
        "projects",
      ),
    } as const satisfies ClaudeCodePaths;
  });

  const allClaudeProjectsDirPaths = Effect.gen(function* () {
    const { claudeProjectsDirPath } = yield* claudeCodePaths;
    const sessionScanRoots =
      yield* ccvOptionsService.getCcvOptions("sessionScanRoots");

    if (!sessionScanRoots || sessionScanRoots.length === 0) {
      return [claudeProjectsDirPath];
    }

    const discovered: string[] = [];
    for (const root of sessionScanRoots) {
      const resolved = resolve(root);
      discovered.push(...discoverClaudeProjectsDirs(resolved, 5));
    }

    // Deduplicate and prepend primary dir
    const seen = new Set<string>([claudeProjectsDirPath]);
    const result = [claudeProjectsDirPath];
    for (const dir of discovered) {
      if (!seen.has(dir)) {
        seen.add(dir);
        result.push(dir);
      }
    }

    return result;
  });

  return {
    claudeCodePaths,
    allClaudeProjectsDirPaths,
  };
});

export type IApplicationContext = InferEffect<typeof LayerImpl>;
export class ApplicationContext extends EffectContext.Tag("ApplicationContext")<
  ApplicationContext,
  IApplicationContext
>() {
  static Live = Layer.effect(this, LayerImpl);
}
