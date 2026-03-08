import { spawn } from "node:child_process";
import type { FileSystem, Path } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer, Runtime } from "effect";
import { ulid } from "ulid";
import { controllablePromise } from "../../../../lib/controllablePromise";
import type { UserConfig } from "../../../lib/config/config";
import type { InferEffect } from "../../../lib/effect/types";
import { EventBus } from "../../events/services/EventBus";
import type { CcvOptionsService } from "../../platform/services/CcvOptionsService";
import type { EnvService } from "../../platform/services/EnvService";
import { SessionRepository } from "../../session/infrastructure/SessionRepository";
import { VirtualConversationDatabase } from "../../session/infrastructure/VirtualConversationDatabase";
import type { SessionMetaService } from "../../session/services/SessionMetaService";
import * as CCSessionProcess from "../models/CCSessionProcess";
import * as ClaudeCode from "../models/ClaudeCode";
import type * as CCTurn from "../models/ClaudeCodeTurn";
import type { UserMessageInput } from "../schema";
import { AcpxSessionLookupService } from "./AcpxSessionLookupService";
import { ClaudeCodeSessionProcessService } from "./ClaudeCodeSessionProcessService";

const LayerImpl = Effect.gen(function* () {
  const eventBusService = yield* EventBus;
  const sessionRepository = yield* SessionRepository;
  const sessionProcessService = yield* ClaudeCodeSessionProcessService;
  const virtualConversationDatabase = yield* VirtualConversationDatabase;
  const acpxSessionLookup = yield* AcpxSessionLookupService;

  const runtime = yield* Effect.runtime<
    | FileSystem.FileSystem
    | Path.Path
    | CommandExecutor
    | VirtualConversationDatabase
    | SessionMetaService
    | EnvService
    | CcvOptionsService
  >();

  /**
   * Spawn an acpx subprocess and drive the session state machine by parsing
   * human-readable stdout for progress signals. The actual session content is
   * read by the frontend from Claude's JSONL files — we just emit events to
   * trigger refresh.
   */
  const createAcpxDaemon = (options: {
    sessionProcess: CCSessionProcess.CCSessionProcessState;
    task: CCTurn.AliveClaudeCodeTurnState;
    prompt: string;
    cwd: string;
    claudeSessionId?: string;
    sessionInitializedPromise: ReturnType<
      typeof controllablePromise<{ sessionId: string }>
    >;
    sessionFileCreatedPromise: ReturnType<
      typeof controllablePromise<{ sessionId: string }>
    >;
    projectId: string;
  }) => {
    const {
      sessionProcess,
      task,
      prompt,
      cwd,
      claudeSessionId,
      sessionInitializedPromise,
      sessionFileCreatedPromise,
      projectId,
    } = options;

    return async () => {
      // Look up acpx session by cwd + acp_session_id
      const acpxSessionResult = await Runtime.runPromise(runtime)(
        Effect.either(acpxSessionLookup.findSession(cwd, claudeSessionId)),
      );

      if (acpxSessionResult._tag === "Left") {
        const error = new Error(acpxSessionResult.left.message);
        if (sessionInitializedPromise.status === "pending") {
          sessionInitializedPromise.reject(error);
        }
        if (sessionFileCreatedPromise.status === "pending") {
          sessionFileCreatedPromise.reject(error);
        }
        throw error;
      }

      const acpxSession = acpxSessionResult.right;
      const sessionId = acpxSession.acp_session_id;

      const { acpxExecutablePath } = await Runtime.runPromise(runtime)(
        ClaudeCode.AcpxConfig,
      );

      // Transition to not_initialized immediately
      await Runtime.runPromise(runtime)(
        sessionProcessService.toNotInitializedState({
          sessionProcessId: sessionProcess.def.sessionProcessId,
          rawUserMessage: prompt,
        }),
      );

      const args: string[] = ["claude", "prompt", prompt];

      if (acpxSession.name !== undefined) {
        args.push("-s", acpxSession.name);
      }

      let hasInitialized = false;
      let hasReceivedContent = false;

      // Spawn acpx subprocess
      const child = spawn(acpxExecutablePath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal: sessionProcess.def.abortController.signal,
        cwd,
      });

      let buffer = "";

      /**
       * Parse human-readable stdout lines from `acpx claude prompt` to detect
       * progress and drive the state machine. Example stdout:
       *   [client] initialize (running)
       *   [client] session/load (running)
       *   <blank line>
       *   Hello! How can I help you?
       *   [done] end_turn
       */
      const processLine = async (line: string) => {
        const trimmed = line.trim();
        if (trimmed === "") return;

        // Detect session loaded → session_initialized
        if (!hasInitialized && trimmed.startsWith("[client] session/load")) {
          hasInitialized = true;

          await Runtime.runPromise(runtime)(
            Effect.gen(function* () {
              const processState =
                yield* sessionProcessService.getSessionProcess(
                  sessionProcess.def.sessionProcessId,
                );

              if (processState.type !== "not_initialized") return;

              yield* sessionProcessService.toInitializedState({
                sessionProcessId: sessionProcess.def.sessionProcessId,
                initContext: { sessionId },
              });

              // Create virtual conversation
              const virtualConversation =
                yield* CCSessionProcess.createVirtualConversation(
                  processState,
                  {
                    sessionId,
                    userMessage: processState.rawUserMessage,
                  },
                );

              if (processState.currentTask.def.type === "new") {
                yield* virtualConversationDatabase.createVirtualConversation(
                  projectId,
                  sessionId,
                  [virtualConversation],
                );
              } else if (processState.currentTask.def.type === "resume") {
                const existingSession = yield* sessionRepository.getSession(
                  processState.def.projectId,
                  processState.currentTask.def.baseSessionId,
                );

                const copiedConversations =
                  existingSession.session === null
                    ? []
                    : existingSession.session.conversations;

                yield* virtualConversationDatabase.createVirtualConversation(
                  processState.def.projectId,
                  sessionId,
                  [...copiedConversations, virtualConversation],
                );
              }

              sessionInitializedPromise.resolve({ sessionId });

              yield* eventBusService.emit("sessionListChanged", {
                projectId: processState.def.projectId,
              });

              yield* eventBusService.emit("sessionChanged", {
                projectId: processState.def.projectId,
                sessionId,
              });
            }),
          );
          return;
        }

        // Detect first assistant content (non-bracket line after initialization)
        if (hasInitialized && !hasReceivedContent && !trimmed.startsWith("[")) {
          hasReceivedContent = true;

          await Runtime.runPromise(runtime)(
            Effect.gen(function* () {
              const processState =
                yield* sessionProcessService.getSessionProcess(
                  sessionProcess.def.sessionProcessId,
                );

              if (processState.type !== "initialized") return;

              yield* sessionProcessService.toFileCreatedState({
                sessionProcessId: sessionProcess.def.sessionProcessId,
              });

              sessionFileCreatedPromise.resolve({ sessionId });

              yield* eventBusService.emit("virtualConversationUpdated", {
                projectId: processState.def.projectId,
                sessionId,
              });

              yield* virtualConversationDatabase.deleteVirtualConversations(
                sessionId,
              );
            }),
          );
          return;
        }

        // Detect turn completed
        if (trimmed.startsWith("[done]")) {
          await Runtime.runPromise(runtime)(
            Effect.gen(function* () {
              const processState =
                yield* sessionProcessService.getSessionProcess(
                  sessionProcess.def.sessionProcessId,
                );

              if (
                processState.type === "file_created" ||
                processState.type === "initialized"
              ) {
                yield* sessionProcessService.toPausedState({
                  sessionProcessId: sessionProcess.def.sessionProcessId,
                  sessionId,
                });

                yield* eventBusService.emit("sessionChanged", {
                  projectId: processState.def.projectId,
                  sessionId,
                });
              }
            }),
          );
          return;
        }

        // For any other content line after initialization, emit sessionChanged
        // to trigger frontend refresh from JSONL files
        if (hasInitialized) {
          await Runtime.runPromise(runtime)(
            eventBusService.emit("sessionChanged", { projectId, sessionId }),
          );
        }
      };

      return new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (data: Buffer) => {
          buffer += data.toString();

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            void processLine(line).catch((error) => {
              Effect.runFork(
                sessionProcessService.changeTurnState({
                  sessionProcessId: sessionProcess.def.sessionProcessId,
                  turnId: task.def.turnId,
                  nextTask: {
                    status: "failed",
                    def: task.def,
                    error,
                  },
                }),
              );

              if (sessionInitializedPromise.status === "pending") {
                sessionInitializedPromise.reject(error);
              }
              if (sessionFileCreatedPromise.status === "pending") {
                sessionFileCreatedPromise.reject(error);
              }
            });
          }
        });

        child.stderr.on("data", (data: Buffer) => {
          const text = data.toString().trim();
          // Log stderr for debugging but don't fail
          if (text !== "") {
            console.error("[acpx stderr]", text);
          }
        });

        child.on("error", (error) => {
          if (sessionInitializedPromise.status === "pending") {
            sessionInitializedPromise.reject(error);
          }
          if (sessionFileCreatedPromise.status === "pending") {
            sessionFileCreatedPromise.reject(error);
          }
          reject(error);
        });

        child.on("close", (_code) => {
          // Process any remaining buffered data
          if (buffer.trim() !== "") {
            void processLine(buffer).catch(() => {});
          }
          resolve();
        });
      });
    };
  };

  const continueSessionProcess = (options: {
    sessionProcessId: string;
    baseSessionId: string;
    input: UserMessageInput;
  }) => {
    const { sessionProcessId, baseSessionId, input } = options;

    return Effect.gen(function* () {
      const { sessionProcess, task } =
        yield* sessionProcessService.continueSessionProcess({
          sessionProcessId,
          turnDef: {
            type: "continue",
            sessionId: baseSessionId,
            baseSessionId: baseSessionId,
            turnId: ulid(),
          },
        });

      const virtualConversation =
        yield* CCSessionProcess.createVirtualConversation(sessionProcess, {
          sessionId: baseSessionId,
          userMessage: input.text,
        });

      yield* virtualConversationDatabase.createVirtualConversation(
        sessionProcess.def.projectId,
        baseSessionId,
        [virtualConversation],
      );

      yield* eventBusService.emit("virtualConversationUpdated", {
        projectId: sessionProcess.def.projectId,
        sessionId: baseSessionId,
      });

      // Spawn new acpx subprocess for this turn
      const sessionInitializedPromise = controllablePromise<{
        sessionId: string;
      }>();
      const sessionFileCreatedPromise = controllablePromise<{
        sessionId: string;
      }>();

      const daemon = createAcpxDaemon({
        sessionProcess,
        task,
        prompt: input.text,
        cwd: sessionProcess.def.cwd,
        claudeSessionId: baseSessionId,
        sessionInitializedPromise,
        sessionFileCreatedPromise,
        projectId: sessionProcess.def.projectId,
      });

      void daemon()
        .catch((error) => {
          console.error("Error in continue daemon process", error);
          if (sessionInitializedPromise.status === "pending") {
            sessionInitializedPromise.reject(error);
          }
          if (sessionFileCreatedPromise.status === "pending") {
            sessionFileCreatedPromise.reject(error);
          }
        })
        .finally(() => {
          Effect.runFork(
            Effect.gen(function* () {
              const currentProcess =
                yield* sessionProcessService.getSessionProcess(
                  sessionProcess.def.sessionProcessId,
                );
              yield* sessionProcessService.toCompletedState({
                sessionProcessId: currentProcess.def.sessionProcessId,
              });
            }),
          );
        });

      return {
        sessionProcess,
        task,
      };
    });
  };

  const startSessionProcess = (options: {
    projectId: string;
    cwd: string;
    input: UserMessageInput;
    userConfig: UserConfig;
    baseSession:
      | undefined
      | {
          type: "fork";
          sessionId: string;
        }
      | {
          type: "resume";
          sessionId: string;
        };
    ccOptions?: CCTurn.CCOptions;
  }) => {
    const { projectId, cwd, input, baseSession, ccOptions } = options;

    return Effect.gen(function* () {
      const { sessionProcess, task } =
        yield* sessionProcessService.startSessionProcess({
          sessionDef: {
            projectId,
            cwd,
            abortController: new AbortController(),
            setNextMessage: () => {},
            sessionProcessId: ulid(),
          },
          turnDef:
            baseSession === undefined
              ? {
                  type: "new",
                  turnId: ulid(),
                  ccOptions,
                }
              : baseSession.type === "fork"
                ? {
                    type: "fork",
                    turnId: ulid(),
                    sessionId: baseSession.sessionId,
                    baseSessionId: baseSession.sessionId,
                    ccOptions,
                  }
                : {
                    type: "resume",
                    turnId: ulid(),
                    sessionId: undefined,
                    baseSessionId: baseSession.sessionId,
                    ccOptions,
                  },
        });

      // For resume/fork, create virtual conversation immediately so the user
      // sees their message before acpx initializes
      if (baseSession !== undefined) {
        const virtualConversation = yield* Effect.promise(() =>
          Runtime.runPromise(runtime)(
            CCSessionProcess.createVirtualConversation(sessionProcess, {
              sessionId: baseSession.sessionId,
              userMessage: input.text,
            }),
          ),
        );

        yield* virtualConversationDatabase.createVirtualConversation(
          projectId,
          baseSession.sessionId,
          [virtualConversation],
        );

        yield* eventBusService.emit("virtualConversationUpdated", {
          projectId,
          sessionId: baseSession.sessionId,
        });
      }

      const sessionInitializedPromise = controllablePromise<{
        sessionId: string;
      }>();
      const sessionFileCreatedPromise = controllablePromise<{
        sessionId: string;
      }>();

      // For resume/fork, pass the base session's sessionId as claudeSessionId
      const claudeSessionId =
        baseSession !== undefined ? baseSession.sessionId : undefined;

      const daemon = createAcpxDaemon({
        sessionProcess,
        task,
        prompt: input.text,
        cwd,
        claudeSessionId,
        sessionInitializedPromise,
        sessionFileCreatedPromise,
        projectId,
      });

      const daemonPromise = daemon()
        .catch((error) => {
          console.error("Error occur in task daemon process", error);
          if (sessionInitializedPromise.status === "pending") {
            sessionInitializedPromise.reject(error);
          }
          if (sessionFileCreatedPromise.status === "pending") {
            sessionFileCreatedPromise.reject(error);
          }
        })
        .finally(() => {
          Effect.runFork(
            Effect.gen(function* () {
              const currentProcess =
                yield* sessionProcessService.getSessionProcess(
                  sessionProcess.def.sessionProcessId,
                );

              yield* sessionProcessService.toCompletedState({
                sessionProcessId: currentProcess.def.sessionProcessId,
              });
            }),
          );
        });

      return {
        sessionProcess,
        task,
        daemonPromise,
        awaitSessionInitialized: async () =>
          await sessionInitializedPromise.promise,
        awaitSessionFileCreated: async () =>
          await sessionFileCreatedPromise.promise,
        yieldSessionInitialized: () =>
          Effect.promise(() => sessionInitializedPromise.promise),
        yieldSessionFileCreated: () =>
          Effect.promise(() => sessionFileCreatedPromise.promise),
      };
    });
  };

  const getPublicSessionProcesses = () =>
    Effect.gen(function* () {
      const processes = yield* sessionProcessService.getSessionProcesses();
      return processes.filter((process) => CCSessionProcess.isPublic(process));
    });

  const abortTask = (sessionProcessId: string): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const currentProcess =
        yield* sessionProcessService.getSessionProcess(sessionProcessId);

      currentProcess.def.abortController.abort();

      yield* sessionProcessService.toCompletedState({
        sessionProcessId: currentProcess.def.sessionProcessId,
        error: new Error("Task aborted"),
      });
    });

  const abortAllTasks = () =>
    Effect.gen(function* () {
      const processes = yield* sessionProcessService.getSessionProcesses();

      for (const process of processes) {
        yield* sessionProcessService.toCompletedState({
          sessionProcessId: process.def.sessionProcessId,
          error: new Error("Task aborted"),
        });
      }
    });

  return {
    continueSessionProcess,
    startSessionProcess,
    abortTask,
    abortAllTasks,
    getPublicSessionProcesses,
  };
});

export type IClaudeCodeLifeCycleService = InferEffect<typeof LayerImpl>;

export class ClaudeCodeLifeCycleService extends Context.Tag(
  "ClaudeCodeLifeCycleService",
)<ClaudeCodeLifeCycleService, IClaudeCodeLifeCycleService>() {
  static Live = Layer.effect(this, LayerImpl);
}
