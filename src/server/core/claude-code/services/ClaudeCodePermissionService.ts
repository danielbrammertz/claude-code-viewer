import { Context, Effect, Layer, Ref } from "effect";
import type {
  PermissionRequest,
  PermissionResponse,
} from "../../../../types/permissions";
import type { InferEffect } from "../../../lib/effect/types";

const LayerImpl = Effect.gen(function* () {
  const pendingPermissionRequestsRef = yield* Ref.make<
    Map<string, PermissionRequest>
  >(new Map());
  const permissionResponsesRef = yield* Ref.make<
    Map<string, PermissionResponse>
  >(new Map());
  /**
   * No-op for acpx mode. The frontend still calls this endpoint, so we keep
   * the interface but permissions are handled via CLI flags.
   */
  const respondToPermissionRequest = (
    response: PermissionResponse,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Ref.update(permissionResponsesRef, (responses) => {
        responses.set(response.permissionRequestId, response);
        return responses;
      });

      yield* Ref.update(pendingPermissionRequestsRef, (requests) => {
        requests.delete(response.permissionRequestId);
        return requests;
      });
    });

  return {
    respondToPermissionRequest,
  };
});

export type IClaudeCodePermissionService = InferEffect<typeof LayerImpl>;

export class ClaudeCodePermissionService extends Context.Tag(
  "ClaudeCodePermissionService",
)<ClaudeCodePermissionService, IClaudeCodePermissionService>() {
  static Live = Layer.effect(this, LayerImpl);
}
