import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Option, Ref } from "effect";
import { z } from "zod";
import type { InferEffect } from "../../../lib/effect/types";
import {
  FileCacheStorage,
  makeFileCacheStorageLayer,
} from "../../../lib/storage/FileCacheStorage";
import { PersistentService } from "../../../lib/storage/FileCacheStorage/PersistentService";
import { parseJsonl } from "../../claude-code/functions/parseJsonl";
import { CcvOptionsService } from "../../platform/services/CcvOptionsService";
import type { ProjectMeta } from "../../types";
import { decodeProjectId } from "../functions/id";

const ProjectPathSchema = z.string().nullable();

/**
 * Extract the group folder name from a claudeProjectPath by matching against
 * configured session scan roots. The group folder is the first path segment
 * after the scan root.
 *
 * e.g. claudeProjectPath = "/data/sessions/telegram_daniel/.claude/projects/-workspace-group"
 *      scanRoot = "/data/sessions"
 *      -> "telegram_daniel"
 */
const extractGroupFolder = (
  claudeProjectPath: string,
  scanRoots: string[],
): string | null => {
  for (const root of scanRoots) {
    const resolved = resolvePath(root);
    const prefix = resolved.endsWith("/") ? resolved : `${resolved}/`;
    if (claudeProjectPath.startsWith(prefix)) {
      const relative = claudeProjectPath.slice(prefix.length);
      const firstSlash = relative.indexOf("/");
      if (firstSlash > 0) {
        return relative.slice(0, firstSlash);
      }
    }
  }
  return null;
};

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ccvOptionsService = yield* CcvOptionsService;
  const projectPathCache = yield* FileCacheStorage<string | null>();
  const projectMetaCacheRef = yield* Ref.make(new Map<string, ProjectMeta>());

  const resolveProjectPath = (
    cwd: string | null,
    claudeProjectPath: string,
  ): Effect.Effect<string | null> =>
    Effect.gen(function* () {
      if (cwd === null) return null;

      const template = yield* ccvOptionsService.getCcvOptions(
        "projectPathTemplate",
      );
      if (!template) return cwd;

      // If the original path exists on the host, use it as-is
      if (existsSync(cwd)) return cwd;

      // Extract group folder from the claude project path
      const scanRoots =
        yield* ccvOptionsService.getCcvOptions("sessionScanRoots");
      if (!scanRoots || scanRoots.length === 0) return cwd;

      const groupFolder = extractGroupFolder(claudeProjectPath, scanRoots);
      if (!groupFolder) return cwd;

      return template.replace(/\{group\}/g, groupFolder);
    });

  const extractProjectPathFromJsonl = (
    filePath: string,
  ): Effect.Effect<string | null, Error> =>
    Effect.gen(function* () {
      const cached = yield* projectPathCache.get(filePath);
      if (cached !== undefined) {
        return cached;
      }

      const content = yield* fs.readFileString(filePath);
      const lines = content.split("\n");

      let cwd: string | null = null;

      for (const line of lines) {
        const conversation = parseJsonl(line).at(0);

        if (
          conversation === undefined ||
          conversation.type === "summary" ||
          conversation.type === "x-error" ||
          conversation.type === "file-history-snapshot" ||
          conversation.type === "queue-operation" ||
          conversation.type === "custom-title" ||
          conversation.type === "agent-name"
        ) {
          continue;
        }

        cwd = conversation.cwd;
        break;
      }

      if (cwd !== null) {
        yield* projectPathCache.set(filePath, cwd);
      }

      return cwd;
    });

  const getProjectMeta = (
    projectId: string,
  ): Effect.Effect<ProjectMeta, Error> =>
    Effect.gen(function* () {
      const metaCache = yield* Ref.get(projectMetaCacheRef);
      const cached = metaCache.get(projectId);
      if (cached !== undefined) {
        return cached;
      }

      const claudeProjectPath = decodeProjectId(projectId);

      const dirents = yield* fs.readDirectory(claudeProjectPath);
      const fileEntries = yield* Effect.all(
        dirents
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) =>
            Effect.gen(function* () {
              const fullPath = path.resolve(claudeProjectPath, name);
              const stat = yield* fs.stat(fullPath);
              const mtime = Option.getOrElse(stat.mtime, () => new Date(0));
              return {
                fullPath,
                mtime,
              } as const;
            }),
          ),
        { concurrency: "unbounded" },
      );

      const files = fileEntries.sort((a, b) => {
        return a.mtime.getTime() - b.mtime.getTime();
      });

      let projectPath: string | null = null;

      for (const file of files) {
        projectPath = yield* extractProjectPathFromJsonl(file.fullPath);

        if (projectPath === null) {
          continue;
        }

        break;
      }

      // Resolve container-internal paths to host paths if configured
      const resolvedPath = yield* resolveProjectPath(
        projectPath,
        claudeProjectPath,
      );

      const projectMeta: ProjectMeta = {
        projectName: resolvedPath ? path.basename(resolvedPath) : null,
        projectPath: resolvedPath,
        rawProjectPath: projectPath,
        sessionCount: files.length,
      };

      yield* Ref.update(projectMetaCacheRef, (cache) => {
        cache.set(projectId, projectMeta);
        return cache;
      });

      return projectMeta;
    });

  const invalidateProject = (projectId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Ref.update(projectMetaCacheRef, (cache) => {
        cache.delete(projectId);
        return cache;
      });
    });

  return {
    getProjectMeta,
    invalidateProject,
  };
});

export type IProjectMetaService = InferEffect<typeof LayerImpl>;

export class ProjectMetaService extends Context.Tag("ProjectMetaService")<
  ProjectMetaService,
  IProjectMetaService
>() {
  static Live = Layer.effect(this, LayerImpl).pipe(
    Layer.provide(
      makeFileCacheStorageLayer("project-path-cache", ProjectPathSchema),
    ),
    Layer.provide(PersistentService.Live),
  );
}
