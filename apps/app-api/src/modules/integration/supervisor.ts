import {
  DEFAULT_SUPERVISOR_API_EVAL_TIMEOUT_MS,
  DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
  parsePositiveInteger,
  type Env,
} from "../../config";
import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import {
  applyTracePropagationHeaders,
  resolveTracePropagationHeaders,
  type TracePropagationHeaders,
} from "../telemetry/trace";
import {
  summarizeObservedSources,
  type ObservedSourceTraceEntry,
} from "../source-trace";

export interface RequestedScope {
  corpus: string;
  collection: string;
}

export interface SupervisorPromptTrace {
  modelName: string | null;
  modelProvider: string | null;
  outputSchemaVersion: string | null;
  promptId: string | null;
  promptVersion: string | null;
  templateSha256: string | null;
  variablesSchemaVersion: string | null;
}

export interface SupervisorProfileMemoryItem {
  itemId: string;
  key: string;
  value: string;
  confidence?: string;
  lastVerifiedAt?: string;
  sourceType?: string;
  visibility?: string;
}

export interface SupervisorProfileMemorySummary {
  items: SupervisorProfileMemoryItem[];
}

export interface SupervisorSessionSlot {
  confirmed?: boolean;
  name: string;
  value: string;
}

export interface SupervisorSessionSummary {
  confirmedSlots: SupervisorSessionSlot[];
  turnCount: number;
}

export interface SupervisorContextProjection {
  actor: ExecutionActorContext;
  authorization: ExecutionAuthorizationContext;
  profileMemory: SupervisorProfileMemorySummary;
  session: SupervisorSessionSummary;
}

export interface SupervisorExecutionInput {
  actor?: ExecutionActorContext;
  context: SupervisorContextProjection;
  conversationId: string;
  requestId: string;
  requestedCapability?: string;
  requestedScope?: RequestedScope | null;
  surface?: string;
  traceHeaders?: TracePropagationHeaders;
  traceId: string;
  userGoal: string;
}

export interface SupervisorExecutionObservability {
  aclAnomalyCode: string | null;
  aclDecision: string | null;
  cachedInputTokens: number | null;
  candidateCount: number | null;
  citationCount: number | null;
  citationExpected: boolean | null;
  citationMissing: boolean | null;
  estimatedCostMicrousd: number | null;
  failClosed: boolean | null;
  inputTokens: number | null;
  modelName: string | null;
  modelProvider: string | null;
  outputTokens: number | null;
  policyReason?: string | null;
  promptRuntimeDetail?: string | null;
  promptRuntimeState?: string | null;
  promptTrace?: SupervisorPromptTrace | null;
  resolvedScopeCollection?: string | null;
  resolvedScopeCorpus?: string | null;
  refusalClass: string | null;
  retrievedSourceCount: number | null;
  retrievedSources?: ObservedSourceTraceEntry[] | null;
  retrievalAttempted: boolean | null;
  scopeClass?: string | null;
  semanticOutcome?: string | null;
}

export interface SupervisorExecutionResponse {
  answerText: string;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  } | null;
  followUpQuestion: string;
  observability?: SupervisorExecutionObservability | null;
  result: unknown;
  selectedTarget: string | null;
  status:
    | "completed"
    | "needs_clarification"
    | "no_answer"
    | "error"
    | "approval_required"
    | "rejected";
  traceId: string;
}

export interface SupervisorExecutionClient {
  execute(input: SupervisorExecutionInput): Promise<SupervisorExecutionResponse>;
}

export async function probeSupervisorApiReady(
  env: Pick<
    Env,
    | "SUPERVISOR_API_BASE_URL"
    | "SUPERVISOR_API_TIMEOUT_MS"
  >,
  input: {
    fetchImplementation?: typeof fetch;
  } = {},
): Promise<void> {
  const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new SupervisorTransportError({
      code: "dependency_not_ready",
      message: "Supervisor runtime is not configured.",
      retryable: true,
      status: 503,
    });
  }

  const timeoutMs = parsePositiveInteger(
    env.SUPERVISOR_API_TIMEOUT_MS,
    DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
  );
  const fetchImplementation = input.fetchImplementation ?? fetch;

  let response: Response;
  try {
    response = await new Promise<Response>((resolve, reject) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(
          new SupervisorTransportError({
            code: "execution_timeout",
            message: `Supervisor readiness probe exceeded ${timeoutMs}ms timeout.`,
            retryable: true,
            status: 504,
          }),
        );
      }, timeoutMs);

      fetchImplementation(`${baseUrl}/readyz`, {
        method: "GET",
        signal: controller.signal,
      })
        .then(resolve)
        .catch((error) => {
          if (error instanceof Error && error.name === "AbortError") {
            reject(
              new SupervisorTransportError({
                code: "execution_timeout",
                message: `Supervisor readiness probe exceeded ${timeoutMs}ms timeout.`,
                retryable: true,
                status: 504,
              }),
            );
            return;
          }

          reject(error);
        })
        .finally(() => {
          clearTimeout(timeoutId);
        });
    });
  } catch (error) {
    if (error instanceof SupervisorTransportError) {
      throw error;
    }

    throw new SupervisorTransportError({
      code: "supervisor_unavailable",
      message: error instanceof Error ? error.message : "Supervisor readiness probe failed.",
      retryable: true,
      status: 502,
    });
  }

  if (response.status !== 200) {
    throw new SupervisorTransportError({
      code: mapStatusCodeToErrorCode(response.status),
      message: `Supervisor readiness probe returned ${response.status}.`,
      retryable: response.status >= 500,
      status: response.status,
    });
  }
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
    cohort: actor.cohort,
    user_id: actor.userId,
    major: actor.major,
    principal_id: actor.principalId,
    principal_type: actor.principalType,
    program: actor.program,
    roles: actor.roles,
    departments: actor.departments,
  };
}

function toSupervisorContext(context: SupervisorContextProjection) {
  return {
    actor: toSupervisorActor(context.actor),
    authorization: {
      principal_id: context.authorization.principalId,
      projection_source: context.authorization.projectionSource,
      entitlement_snapshot_id: context.authorization.entitlementSnapshotId,
      entitlement_groups: context.authorization.entitlementGroups,
      visibility_scope: context.authorization.visibilityScope,
      applicability_scope: context.authorization.applicabilityScope,
      ownership_scopes: context.authorization.ownershipScopes,
      approval_state: context.authorization.approvalState,
      retrieval_filter: {
        entitlement_groups: context.authorization.retrievalFilter.entitlementGroups,
        policy_projection_version:
          context.authorization.retrievalFilter.policyProjectionVersion,
        visibility_level: context.authorization.retrievalFilter.visibilityLevel,
        visibility_scope: context.authorization.retrievalFilter.visibilityScope,
      },
    },
    profile_memory: {
      items: context.profileMemory.items.map((item) => ({
        item_id: item.itemId,
        key: item.key,
        value: item.value,
        source_type: item.sourceType,
        confidence: item.confidence,
        visibility: item.visibility,
        last_verified_at: item.lastVerifiedAt,
      })),
    },
    session: {
      confirmed_slots: context.session.confirmedSlots.map((slot) => ({
        confirmed: slot.confirmed,
        name: slot.name,
        value: slot.value,
      })),
      turn_count: context.session.turnCount,
    },
  };
}

function mapStatusCodeToErrorCode(status: number): string {
  if (status === 504) {
    return "execution_timeout";
  }

  return "supervisor_unavailable";
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  return Number.isFinite(value) ? Number(value) : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parsePromptTrace(value: unknown): SupervisorPromptTrace | null {
  const record = getRecord(value);
  if (!record) {
    return null;
  }

  const parsed: SupervisorPromptTrace = {
    modelName: normalizeNullableString(record.model_name),
    modelProvider: normalizeNullableString(record.model_provider),
    outputSchemaVersion: normalizeNullableString(record.output_schema_version),
    promptId: normalizeNullableString(record.prompt_id),
    promptVersion: normalizeNullableString(record.prompt_version),
    templateSha256: normalizeNullableString(record.template_sha256),
    variablesSchemaVersion: normalizeNullableString(record.variables_schema_version),
  };

  if (Object.values(parsed).every((item) => item === null)) {
    return null;
  }

  return parsed;
}

function parseExecutionObservability(
  value: unknown,
): SupervisorExecutionObservability | null {
  const record = getRecord(value);
  if (!record) {
    return null;
  }

  const resolvedScopeCollection = normalizeNullableString(record.resolved_scope_collection);
  const resolvedScopeCorpus = normalizeNullableString(record.resolved_scope_corpus);
  const rawRetrievedSources =
    "retrieved_sources" in record ? record.retrieved_sources : record.retrievedSources;
  const hasRetrievedSourcesTrace = Array.isArray(rawRetrievedSources);
  const retrievedSources = summarizeObservedSources(rawRetrievedSources);
  const retrievalAttempted = normalizeNullableBoolean(record.retrieval_attempted);
  const explicitRetrievedSourceCount = normalizeNullableNumber(record.retrieved_source_count);
  const retrievedSourceCount =
    explicitRetrievedSourceCount ??
    (retrievalAttempted === true && hasRetrievedSourcesTrace ? retrievedSources.length : null);
  const parsed: SupervisorExecutionObservability = {
    aclAnomalyCode: normalizeNullableString(record.acl_anomaly_code),
    aclDecision: normalizeNullableString(record.acl_decision),
    cachedInputTokens: normalizeNullableNumber(record.cached_input_tokens),
    candidateCount: normalizeNullableNumber(record.candidate_count),
    citationCount: normalizeNullableNumber(record.citation_count),
    citationExpected: normalizeNullableBoolean(record.citation_expected),
    citationMissing: normalizeNullableBoolean(record.citation_missing),
    estimatedCostMicrousd: normalizeNullableNumber(record.estimated_cost_microusd),
    failClosed: normalizeNullableBoolean(record.fail_closed),
    inputTokens: normalizeNullableNumber(record.input_tokens),
    modelName: normalizeNullableString(record.model_name),
    modelProvider: normalizeNullableString(record.model_provider),
    outputTokens: normalizeNullableNumber(record.output_tokens),
    policyReason: normalizeNullableString(record.policy_reason),
    promptRuntimeDetail: normalizeNullableString(record.prompt_runtime_detail),
    promptRuntimeState: normalizeNullableString(record.prompt_runtime_state),
    promptTrace: parsePromptTrace(record.prompt_trace),
    refusalClass: normalizeNullableString(record.refusal_class),
    retrievedSourceCount,
    ...(hasRetrievedSourcesTrace ? { retrievedSources } : {}),
    retrievalAttempted,
    scopeClass: normalizeNullableString(record.scope_class),
    semanticOutcome: normalizeNullableString(record.semantic_outcome),
    ...(resolvedScopeCollection ? { resolvedScopeCollection } : {}),
    ...(resolvedScopeCorpus ? { resolvedScopeCorpus } : {}),
  };

  if (Object.values(parsed).every((item) => item === null)) {
    return null;
  }

  return parsed;
}

export function createSupervisorExecutionClient(
  env: Pick<
    Env,
    | "SUPERVISOR_API_BASE_URL"
    | "SUPERVISOR_API_SHARED_SECRET"
    | "SUPERVISOR_API_TIMEOUT_MS"
    | "SUPERVISOR_API_EVAL_TIMEOUT_MS"
  >,
  input: {
    fetchImplementation?: typeof fetch;
    traceDataProvider?: () => Record<string, unknown>;
  } = {},
): SupervisorExecutionClient {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const traceDataProvider = input.traceDataProvider ?? (() => ({}));

  return {
    async execute(payload: SupervisorExecutionInput): Promise<SupervisorExecutionResponse> {
      const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
      const sharedSecret = env.SUPERVISOR_API_SHARED_SECRET?.trim();
      const defaultTimeoutMs = parsePositiveInteger(
        env.SUPERVISOR_API_TIMEOUT_MS,
        DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
      );
      const evalTimeoutMs = parsePositiveInteger(
        env.SUPERVISOR_API_EVAL_TIMEOUT_MS,
        DEFAULT_SUPERVISOR_API_EVAL_TIMEOUT_MS,
      );
      const timeoutMs = payload.surface === "eval_benchmark" ? evalTimeoutMs : defaultTimeoutMs;
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
        response = await new Promise<Response>((resolve, reject) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
            reject(
              new SupervisorTransportError({
                code: "execution_timeout",
                message: `Supervisor execution exceeded ${timeoutMs}ms timeout.`,
                retryable: true,
                status: 504,
              }),
            );
          }, timeoutMs);

          const headers = new Headers({
            "content-type": "application/json",
            "x-trace-id": payload.traceId,
            "x-worker-origin-auth": sharedSecret,
          });
          applyTracePropagationHeaders(
            headers,
            resolveTracePropagationHeaders({
              traceData: traceDataProvider(),
            }),
          );
          if (payload.traceHeaders) {
            applyTracePropagationHeaders(headers, payload.traceHeaders);
          }

          const requestBody = {
            context: toSupervisorContext(payload.context),
            conversation_id: payload.conversationId,
            request_id: payload.requestId,
            requested_capability: payload.requestedCapability,
            ...(payload.requestedScope ? { requested_scope: payload.requestedScope } : {}),
            user_goal: payload.userGoal,
          };

          fetchImplementation(`${baseUrl}/api/v1/answer`, {
            method: "POST",
            headers: Object.fromEntries(headers.entries()),
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          })
            .then(resolve)
            .catch((error) => {
              if (error instanceof Error && error.name === "AbortError") {
                reject(
                  new SupervisorTransportError({
                    code: "execution_timeout",
                    message: `Supervisor execution exceeded ${timeoutMs}ms timeout.`,
                    retryable: true,
                    status: 504,
                  }),
                );
                return;
              }

              reject(error);
            })
            .finally(() => {
              clearTimeout(timeoutId);
            });
        });
      } catch (error) {
        if (error instanceof SupervisorTransportError) {
          throw error;
        }

        throw new SupervisorTransportError({
          code: "supervisor_unavailable",
          message: error instanceof Error ? error.message : "Supervisor request failed.",
          retryable: true,
          status: 502,
        });
      }

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = (await response.json()) as Record<string, unknown>;
      } catch {
        if (response.status === 200) {
          throw new SupervisorTransportError({
            code: "supervisor_invalid_response",
            message: "Supervisor returned an invalid JSON response.",
            retryable: true,
            status: 502,
          });
        }
      }

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
              ? (((errorBody as { message: string }).message as string) ??
                  "Supervisor execution request failed.")
              : "Supervisor execution request failed.",
          retryable:
            errorBody && typeof (errorBody as { retryable?: unknown }).retryable === "boolean"
              ? (((errorBody as { retryable: boolean }).retryable as boolean) ??
                  response.status >= 500)
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
        observability: parseExecutionObservability(parsed?.observability),
        result: parsed?.result ?? null,
        selectedTarget: typeof parsed?.selected_target === "string" ? parsed.selected_target : null,
        status:
          parsed?.status === "needs_clarification" ||
          parsed?.status === "no_answer" ||
          parsed?.status === "error" ||
          parsed?.status === "approval_required" ||
          parsed?.status === "rejected"
            ? parsed.status
            : "completed",
        traceId: typeof parsed?.trace_id === "string" ? parsed.trace_id : payload.traceId,
      };
    },
  };
}
