import type { Env } from "../../config";
import type { ExecutionActorContext } from "../auth";

export interface RequestedScope {
  corpus: string;
  collection: string;
}

export interface SupervisorExecutionInput {
  actor: ExecutionActorContext;
  conversationId: string;
  requestId: string;
  requestedCapability?: string;
  requestedScope?: RequestedScope;
  traceId: string;
  userGoal: string;
}

export interface SupervisorExecutionResponse {
  answerText: string;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  } | null;
  followUpQuestion: string;
  result: unknown;
  status: "completed" | "needs_clarification" | "no_answer" | "error";
  target: string;
  traceId: string;
}

export interface SupervisorExecutionClient {
  execute(input: SupervisorExecutionInput): Promise<SupervisorExecutionResponse>;
}

export class SupervisorTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    status: number;
  }) {
    super(input.message);
    this.name = "SupervisorTransportError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

function toSupervisorActor(actor: ExecutionActorContext) {
  return {
    user_id: actor.userId,
    roles: actor.roles,
    departments: actor.departments,
    groups: actor.groups,
    campus_scope: actor.campusScope,
    snapshot: actor.snapshot,
  };
}

function mapStatusCodeToErrorCode(status: number): string {
  if (status === 504) {
    return "execution_timeout";
  }

  return "supervisor_unavailable";
}

export function createSupervisorExecutionClient(
  env: Pick<Env, "SUPERVISOR_API_BASE_URL" | "SUPERVISOR_API_SHARED_SECRET">,
  input: {
    fetchImplementation?: typeof fetch;
  } = {},
): SupervisorExecutionClient {
  const fetchImplementation = input.fetchImplementation ?? fetch;

  return {
    async execute(payload: SupervisorExecutionInput): Promise<SupervisorExecutionResponse> {
      const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
      const sharedSecret = env.SUPERVISOR_API_SHARED_SECRET?.trim();
      if (!baseUrl || !sharedSecret) {
        throw new SupervisorTransportError({
          code: "dependency_not_ready",
          message: "Supervisor runtime is not configured.",
          retryable: true,
          status: 503,
        });
      }

      let response: Response;
      try {
        response = await fetchImplementation(`${baseUrl}/api/v1/answer`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-trace-id": payload.traceId,
            "x-worker-origin-auth": sharedSecret,
          },
          body: JSON.stringify({
            actor: toSupervisorActor(payload.actor),
            conversation_id: payload.conversationId,
            request_id: payload.requestId,
            requested_capability: payload.requestedCapability,
            requested_scope: payload.requestedScope,
            user_goal: payload.userGoal,
          }),
        });
      } catch (error) {
        throw new SupervisorTransportError({
          code: "supervisor_unavailable",
          message: error instanceof Error ? error.message : "Supervisor request failed.",
          retryable: true,
          status: 502,
        });
      }

      const parsed = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | null;

      if (response.status !== 200) {
        const errorBody =
          parsed && typeof parsed.error === "object" && parsed.error ? parsed.error : null;
        throw new SupervisorTransportError({
          code:
            errorBody && typeof (errorBody as { code?: unknown }).code === "string"
              ? ((errorBody as { code: string }).code ?? mapStatusCodeToErrorCode(response.status))
              : mapStatusCodeToErrorCode(response.status),
          message:
            errorBody && typeof (errorBody as { message?: unknown }).message === "string"
              ? (((errorBody as { message: string }).message as string) ?? "Supervisor execution request failed.")
              : "Supervisor execution request failed.",
          retryable:
            errorBody && typeof (errorBody as { retryable?: unknown }).retryable === "boolean"
              ? (((errorBody as { retryable: boolean }).retryable as boolean) ?? response.status >= 500)
              : response.status >= 500,
          status: response.status,
        });
      }

      return {
        answerText: typeof parsed?.answer_text === "string" ? parsed.answer_text : "",
        error:
          parsed?.error && typeof parsed.error === "object"
            ? {
                code:
                  typeof (parsed.error as { code?: unknown }).code === "string"
                    ? ((parsed.error as { code: string }).code as string)
                    : "unknown_error",
                message:
                  typeof (parsed.error as { message?: unknown }).message === "string"
                    ? ((parsed.error as { message: string }).message as string)
                    : "Supervisor returned an unknown error.",
                retryable:
                  typeof (parsed.error as { retryable?: unknown }).retryable === "boolean"
                    ? ((parsed.error as { retryable: boolean }).retryable as boolean)
                    : undefined,
              }
            : null,
        followUpQuestion:
          typeof parsed?.follow_up_question === "string" ? parsed.follow_up_question : "",
        result: parsed?.result ?? null,
        status:
          parsed?.status === "needs_clarification" ||
          parsed?.status === "no_answer" ||
          parsed?.status === "error"
            ? parsed.status
            : "completed",
        target: typeof parsed?.target === "string" ? parsed.target : "rag-specialist",
        traceId: typeof parsed?.trace_id === "string" ? parsed.trace_id : payload.traceId,
      };
    },
  };
}
