import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Option } from "effect";
import type { InferEffect } from "../../../lib/effect/types";
import { ApplicationContext } from "../../platform/services/ApplicationContext";
import type { Project } from "../../types";
import { decodeProjectId, encodeProjectId } from "../functions/id";
import { ProjectMetaService } from "../services/ProjectMetaService";

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectMetaService = yield* ProjectMetaService;
  const context = yield* ApplicationContext;

  const getProject = (projectId: string) =>
    Effect.gen(function* () {
      const fullPath = decodeProjectId(projectId);

      // Check if project directory exists
      const exists = yield* fs.exists(fullPath);
      if (!exists) {
        return yield* Effect.fail(new Error("Project not found"));
      }

      // Get file stats
      const stat = yield* fs.stat(fullPath);

      // Get project metadata
      const meta = yield* projectMetaService.getProjectMeta(projectId);

      return {
        project: {
          id: projectId,
          claudeProjectPath: fullPath,
          lastModifiedAt: Option.getOrElse(stat.mtime, () => new Date()),
          meta,
        },
      };
    });

  const scanProjectsDir = (claudeProjectsDirPath: string) =>
    Effect.gen(function* () {
      const dirExists = yield* fs.exists(claudeProjectsDirPath);
      if (!dirExists) {
        return [];
      }

      const entries = yield* fs.readDirectory(claudeProjectsDirPath);

      const projectEffects = entries.map((entry) =>
        Effect.gen(function* () {
          const fullPath = path.resolve(claudeProjectsDirPath, entry);

          const stat = yield* Effect.tryPromise(() =>
            fs.stat(fullPath).pipe(Effect.runPromise),
          ).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (!stat || stat.type !== "Directory") {
            return null;
          }

          const id = encodeProjectId(fullPath);
          const meta = yield* projectMetaService.getProjectMeta(id);

          return {
            id,
            claudeProjectPath: fullPath,
            lastModifiedAt: Option.getOrElse(stat.mtime, () => new Date()),
            meta,
          } satisfies Project;
        }),
      );

      const projectsWithNulls = yield* Effect.all(projectEffects, {
        concurrency: "unbounded",
      });
      return projectsWithNulls.filter((p): p is Project => p !== null);
    });

  const getProjects = () =>
    Effect.gen(function* () {
      const allDirs = yield* context.allClaudeProjectsDirPaths;

      const perDirResults = yield* Effect.all(
        allDirs.map((dir) => scanProjectsDir(dir)),
        { concurrency: "unbounded" },
      );

      // Merge and deduplicate by id (first occurrence wins)
      const seen = new Set<string>();
      const projects: Project[] = [];
      for (const dirProjects of perDirResults) {
        for (const project of dirProjects) {
          if (!seen.has(project.id)) {
            seen.add(project.id);
            projects.push(project);
          }
        }
      }

      // Sort by last modified date (newest first)
      projects.sort((a, b) => {
        return (
          (b.lastModifiedAt ? b.lastModifiedAt.getTime() : 0) -
          (a.lastModifiedAt ? a.lastModifiedAt.getTime() : 0)
        );
      });

      return { projects };
    });

  return {
    getProject,
    getProjects,
  };
});

export type IProjectRepository = InferEffect<typeof LayerImpl>;
export class ProjectRepository extends Context.Tag("ProjectRepository")<
  ProjectRepository,
  IProjectRepository
>() {
  static Live = Layer.effect(this, LayerImpl);
}
