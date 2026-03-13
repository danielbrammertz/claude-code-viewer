import { homedir } from "node:os";
import { Context, Effect, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse";
import type { InferEffect } from "../../../lib/effect/types";
import { ProjectRepository } from "../../project/infrastructure/ProjectRepository";
import { getDirectoryListing } from "../functions/getDirectoryListing";
import { getFileCompletion } from "../functions/getFileCompletion";
import { getFileContent } from "../functions/getFileContent";

/**
 * Rewrite an absolute file path from container-internal CWD space to the
 * resolved host project path. For example:
 *   filePath      = "/workspace/group/src/index.ts"
 *   rawCwd        = "/workspace/group"
 *   resolvedRoot  = "/home/node/nanoclaw/groups/telegram_daniel"
 *   -> "src/index.ts"  (made relative so getFileContent resolves against resolvedRoot)
 */
const rewriteFilePath = (
  filePath: string,
  rawProjectPath: string | null,
  projectPath: string,
): string => {
  if (!rawProjectPath || rawProjectPath === projectPath) return filePath;
  if (!filePath.startsWith("/")) return filePath;

  const rawPrefix = rawProjectPath.endsWith("/")
    ? rawProjectPath
    : `${rawProjectPath}/`;
  if (filePath.startsWith(rawPrefix)) {
    return filePath.slice(rawPrefix.length);
  }
  if (filePath === rawProjectPath) {
    return ".";
  }
  return filePath;
};

const LayerImpl = Effect.gen(function* () {
  const projectRepository = yield* ProjectRepository;

  const getFileCompletionRoute = (options: {
    projectId: string;
    basePath: string;
  }) =>
    Effect.gen(function* () {
      const { projectId, basePath } = options;

      const { project } = yield* projectRepository.getProject(projectId);

      if (project.meta.projectPath === null) {
        return {
          response: { error: "Project path not found" },
          status: 400,
        } as const satisfies ControllerResponse;
      }

      const projectPath = project.meta.projectPath;
      const rewrittenBasePath = rewriteFilePath(
        basePath,
        project.meta.rawProjectPath,
        projectPath,
      );

      try {
        const result = yield* Effect.promise(() =>
          getFileCompletion(projectPath, rewrittenBasePath),
        );
        return {
          response: result,
          status: 200,
        } as const satisfies ControllerResponse;
      } catch (error) {
        console.error("File completion error:", error);
        return {
          response: { error: "Failed to get file completion" },
          status: 500,
        } as const satisfies ControllerResponse;
      }
    });

  const getDirectoryListingRoute = (options: {
    currentPath?: string | undefined;
    showHidden?: boolean | undefined;
  }) =>
    Effect.promise(async () => {
      const { currentPath, showHidden = false } = options;

      const rootPath = "/";
      const defaultPath = homedir();

      try {
        const targetPath = currentPath ?? defaultPath;
        const relativePath = targetPath.startsWith(rootPath)
          ? targetPath.slice(rootPath.length)
          : targetPath;

        const result = await getDirectoryListing(
          rootPath,
          relativePath,
          showHidden,
        );

        return {
          response: result,
          status: 200,
        } as const satisfies ControllerResponse;
      } catch (error) {
        console.error("Directory listing error:", error);
        return {
          response: { error: "Failed to list directory" },
          status: 500,
        } as const satisfies ControllerResponse;
      }
    });

  const getFileContentRoute = (options: {
    projectId: string;
    filePath: string;
  }) =>
    Effect.gen(function* () {
      const { projectId, filePath } = options;

      const { project } = yield* projectRepository.getProject(projectId);

      if (project.meta.projectPath === null) {
        return {
          response: {
            success: false,
            error: "PROJECT_PATH_NOT_SET",
            message:
              "Project path is not configured. Cannot read files without a project root.",
            filePath,
          },
          status: 400,
        } as const satisfies ControllerResponse;
      }

      const projectPath = project.meta.projectPath;
      const rewrittenFilePath = rewriteFilePath(
        filePath,
        project.meta.rawProjectPath,
        projectPath,
      );

      const result = yield* Effect.promise(() =>
        getFileContent(projectPath, rewrittenFilePath),
      );

      if (!result.success) {
        const statusCode = result.error === "NOT_FOUND" ? 404 : 400;
        return {
          response: result,
          status: statusCode,
        } as const satisfies ControllerResponse;
      }

      return {
        response: result,
        status: 200,
      } as const satisfies ControllerResponse;
    });

  return {
    getFileCompletionRoute,
    getDirectoryListingRoute,
    getFileContentRoute,
  };
});

export type IFileSystemController = InferEffect<typeof LayerImpl>;
export class FileSystemController extends Context.Tag("FileSystemController")<
  FileSystemController,
  IFileSystemController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
