import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import { buildExecutionAuthorizationContext, type ResolvedAppPrincipal } from "../auth";
import {
  DRAFT_CONVERSATION_TITLE,
  toConversationResponse,
  type ChatConversation,
  type ChatConversationStore,
  type ChatMessage,
} from "../chat";
import {
  SupervisorTransportError,
  type RequestedScope,
  type SupervisorExecutionClient,
  type SupervisorExecutionResponse,
} from "../integration";
import { extractRequestDiagnosticsSummary } from "../request-diagnostics";
import type { AppTelemetry } from "../telemetry";
import type {
  AcceptRequestWrite,
  ChatCommandStore,
  FinalizeRequestWrite,
  RequestExecutionStatus,
} from "./store";

const DEFAULT_REQUESTED_SCOPE = {
  corpus: "regulations",
  collection: "student_handbook",
} satisfies RequestedScope;

const NEW_CONVERSATION_FINGERPRINT_SCOPE = "__new__";

export interface ChatCommandPayload {
  conversationId?: unknown;
  prompt?: unknown;
  requestedCapability?: unknown;
  requestedScope?: unknown;
}

export type ChatCommandResult =
  | {
      kind: "answer" | "clarification" | "no_answer";
      requestId: string;
      text: string;
      traceId: string;
    }
  | {
      errorCode: string;
      kind: "error";
      message: string;
      requestId: string;
      retryable: boolean;
      traceId: string;
    };

export interface ChatCommandResponse {
  answer: {
    conversation: ReturnType<typeof toConversationResponse>;
    result: ChatCommandResult;
  };
  requestId: string;
  traceId: string;
}

export interface ChatCommandService {
  submit(input: {
    idempotencyKey?: string | null;
    payload: ChatCommandPayload;
    principal: ResolvedAppPrincipal;
  }): Promise<ChatCommandResponse>;
}

export interface ChatCommandServiceDependencies {
  computeFingerprint?: (input: {
    conversationDiscriminator: string;
    prompt: string;
    requestedCapability: string;
    requestedScope: RequestedScope;
  }) => string;
  conversationStore: ChatConversationStore;
  generateId?: (prefix: string) => string;
  now?: () => Date;
  store: ChatCommandStore;
  supervisor: SupervisorExecutionClient;
  telemetry?: AppTelemetry;
}

function defaultGenerateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function defaultComputeFingerprint(input: {
  conversationDiscriminator: string;
  prompt: string;
  requestedCapability: string;
  requestedScope: RequestedScope;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        conversationDiscriminator: input.conversationDiscriminator,
        prompt: input.prompt,
        requestedCapability: input.requestedCapability,
        requestedScope: input.requestedScope,
      }),
    )
    .digest("hex");
}

function previewText(text: string, maxLength = 160): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequestedScope(value: unknown): RequestedScope | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const scope = value as Record<string, unknown>;
  const corpus = normalizeString(scope.corpus);
  const collection = normalizeString(scope.collection);
  if (!corpus || !collection) {
    return null;
  }

  return { corpus, collection };
}

function normalizeRequestedCapability(value: unknown): string | null {
  const capability = normalizeString(value);
  return capability || null;
}

function buildConversationTitle(currentTitle: string, prompt: string): string {
  if (currentTitle !== DRAFT_CONVERSATION_TITLE && currentTitle.trim()) {
    return currentTitle;
  }

  return previewText(prompt, 48);
}

function buildSupervisorContextProjection(input: {
  actor: ResolvedAppPrincipal["actor"];
  authorization?: ResolvedAppPrincipal["authorization"];
  turnCount: number;
}) {
  return {
    actor: input.actor,
    authorization: input.authorization ?? buildExecutionAuthorizationContext(input.actor),
    profileMemory: {
      items: [],
    },
    session: {
      confirmedSlots: [],
      turnCount: Math.max(0, Math.floor(input.turnCount)),
    },
  };
}

function extractSourceDocIds(result: unknown): string[] {
  if (!result || typeof result !== "object") {
    return [];
  }

  const sources = (result as { evidence?: { sources?: Array<{ doc_id?: unknown }> } }).evidence
    ?.sources;
  if (!Array.isArray(sources)) {
    return [];
  }

  return sources
    .map((source) => (typeof source?.doc_id === "string" ? source.doc_id : null))
    .filter((value): value is string => Boolean(value));
}

function createPreAcceptError(input: {
  code: string;
  details?: unknown;
  message: string;
  retryable?: boolean;
  status: number;
}): AppApiRouteError {
  return new AppApiRouteError({
    code: input.code,
    details: input.details,
    message: input.message,
    retryable: input.retryable ?? false,
    status: input.status,
  });
}

function resolveValidatedPayload(payload: ChatCommandPayload): {
  conversationId: string | null;
  prompt: string;
  requestedCapability: string;
  requestedScope: RequestedScope;
} {
  const conversationId = normalizeString(payload.conversationId) || null;

  const prompt = normalizeString(payload.prompt);
  if (!prompt) {
    throw createPreAcceptError({
      code: "validation_failed",
      details: { field: "prompt" },
      message: "prompt is required.",
      status: 422,
    });
  }

  const requestedCapability = normalizeRequestedCapability(payload.requestedCapability) ?? "knowledge";
  if (requestedCapability !== "knowledge") {
    throw createPreAcceptError({
      code: "validation_failed",
      details: { field: "requestedCapability" },
      message: "Only knowledge requests are accepted on this route.",
      status: 422,
    });
  }

  const requestedScope = normalizeRequestedScope(payload.requestedScope) ?? DEFAULT_REQUESTED_SCOPE;
  return {
    conversationId,
    prompt,
    requestedCapability,
    requestedScope,
  };
}

function buildAcceptedWrite(input: {
  conversation: ChatConversation;
  conversationSeed?: {
    id: string;
    ownerUserId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  conversationTitle: string;
  idempotencyKey: string | null;
  now: string;
  principal: ResolvedAppPrincipal;
  prompt: string;
  requestFingerprintSha256: string | null;
  requestId: string;
  requestedCapability: string;
  requestedScope: RequestedScope;
  traceId: string;
  userMessageId: string;
  outboxEventId: string;
}): AcceptRequestWrite {
  const userMessage: ChatMessage = {
    id: input.userMessageId,
    conversationId: input.conversation.id,
    role: "user",
    kind: null,
    text: input.prompt,
    createdAt: input.now,
    requestId: null,
    retryable: null,
  };

  return {
    ...(input.conversationSeed ? { conversationSeed: input.conversationSeed } : {}),
    conversationTitle: input.conversationTitle,
    ownerUserId: input.conversation.ownerUserId,
    userMessage,
    requestExecution: {
      requestId: input.requestId,
      conversationId: input.conversation.id,
      userMessageId: input.userMessageId,
      assistantMessageId: null,
      surface: "public_chat_web",
      actorUserId: input.principal.actor.userId,
      actorPrincipalId: input.principal.actor.principalId,
      actorRoles: input.principal.actor.roles,
      actorDepartments: input.principal.actor.departments,
      actorGroups: input.principal.actor.groups,
      actorCampusScope: input.principal.actor.campusScope,
      principalType: input.principal.principal.type,
      principalLabel: input.principal.principal.displayName,
      entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId || null,
      entitlementGroups: input.principal.authorization?.entitlementGroups ?? [],
      visibilityScope: input.principal.authorization?.visibilityScope ?? null,
      applicabilityScope: input.principal.authorization?.applicabilityScope ?? null,
      idempotencyKey: input.idempotencyKey,
      requestFingerprintSha256: input.requestFingerprintSha256,
      traceId: input.traceId,
      requestedCapability: input.requestedCapability,
      requestedScope: input.requestedScope,
      selectedTarget: null,
      status: "accepted",
      errorCode: null,
      questionPreview: previewText(input.prompt),
      answerPreview: null,
      diagnostics: null,
      sourceDocIds: [],
      startedAt: input.now,
      completedAt: null,
      durationMs: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
    outboxEvent: {
      eventId: input.outboxEventId,
      requestId: input.requestId,
      eventType: "request.accepted",
      payload: {
        requestId: input.requestId,
        traceId: input.traceId,
        conversationId: input.conversation.id,
        status: "accepted",
        questionPreview: previewText(input.prompt),
        requestedCapability: input.requestedCapability,
        requestedScope: input.requestedScope,
        surface: "public_chat_web",
      },
      occurredAt: input.now,
      availableAt: input.now,
      processedAt: null,
      attemptCount: 0,
      lastError: null,
    },
  };
}

function toHandledErrorTransportOutcome(
  error: unknown,
): {
  answerText: string;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  followUpQuestion: string;
  result: null;
  selectedTarget: null;
  status: "error";
  traceId: string;
} {
  if (error instanceof SupervisorTransportError) {
    return {
      answerText: "",
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
      followUpQuestion: "",
      result: null,
      selectedTarget: null,
      status: "error",
      traceId: "",
    };
  }

  return {
    answerText: "",
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Unexpected execution failure.",
      retryable: true,
    },
    followUpQuestion: "",
    result: null,
    selectedTarget: null,
    status: "error",
    traceId: "",
  };
}

function buildFinalizedWrite(input: {
  assistantMessageId: string;
  conversation: ChatConversation;
  conversationTitle: string;
  completedAt: string;
  durationMs: number;
  outboxEventId: string;
  requestId: string;
  response: SupervisorExecutionResponse;
  startedAt: string;
  traceId: string;
}): {
  responseBody: ChatCommandResponse;
  write: FinalizeRequestWrite;
} {
  const normalizedTraceId = input.response.traceId || input.traceId;
  const diagnostics = extractRequestDiagnosticsSummary(input.response.result);
  const sourceDocIds = extractSourceDocIds(input.response.result);

  let assistantKind: ChatMessage["kind"];
  let assistantText: string;
  let errorCode: string | null = null;
  let retryable: boolean | null = null;
  let outboxEventType: string;
  let result: ChatCommandResult;
  let status: RequestExecutionStatus;

  if (input.response.status === "needs_clarification") {
    assistantKind = "clarification";
    assistantText = input.response.followUpQuestion || input.response.answerText;
    outboxEventType = "request.needs_clarification";
    result = {
      kind: "clarification",
      requestId: input.requestId,
      text: assistantText,
      traceId: normalizedTraceId,
    };
    status = "needs_clarification";
  } else if (input.response.status === "no_answer") {
    assistantKind = "no_answer";
    assistantText = input.response.answerText;
    outboxEventType = "request.no_answer";
    result = {
      kind: "no_answer",
      requestId: input.requestId,
      text: assistantText,
      traceId: normalizedTraceId,
    };
    status = "no_answer";
  } else if (
    input.response.status === "error" ||
    input.response.status === "approval_required" ||
    input.response.status === "rejected"
  ) {
    assistantKind = "error";
    assistantText =
      input.response.error?.message ||
      input.response.answerText ||
      (input.response.status === "approval_required"
        ? "The request requires approval before it can continue."
        : input.response.status === "rejected"
          ? "The request was rejected by supervisor policy."
          : "The request could not be completed.");
    errorCode =
      input.response.error?.code ??
      (input.response.status === "approval_required"
        ? "approval_required"
        : input.response.status === "rejected"
          ? "request_rejected"
          : "internal_error");
    retryable =
      input.response.error?.retryable ??
      (input.response.status === "error");
    outboxEventType = `request.${input.response.status}`;
    result = {
      kind: "error",
      message: assistantText,
      errorCode,
      requestId: input.requestId,
      retryable,
      traceId: normalizedTraceId,
    };
    status = input.response.status;
  } else {
    assistantKind = "answer";
    assistantText = input.response.answerText;
    outboxEventType = "request.completed";
    result = {
      kind: "answer",
      requestId: input.requestId,
      text: assistantText,
      traceId: normalizedTraceId,
    };
    status = "completed";
  }

  const assistantMessage: ChatMessage = {
    id: input.assistantMessageId,
    conversationId: input.conversation.id,
    role: "assistant",
    kind: assistantKind,
    text: assistantText,
    createdAt: input.completedAt,
    requestId: input.requestId,
    retryable,
  };

  const write: FinalizeRequestWrite = {
    assistantMessage,
    conversationTitle: input.conversationTitle,
    ownerUserId: input.conversation.ownerUserId,
    requestExecution: {
      requestId: input.requestId,
      conversationId: input.conversation.id,
      userMessageId: "",
      assistantMessageId: input.assistantMessageId,
      surface: "public_chat_web",
      actorUserId: input.conversation.ownerUserId,
      actorPrincipalId: input.conversation.ownerUserId,
      actorRoles: [],
      actorDepartments: [],
      actorGroups: [],
      actorCampusScope: null,
      principalType: "public_user",
      principalLabel: null,
      entitlementSnapshotId: null,
      entitlementGroups: [],
      visibilityScope: null,
      applicabilityScope: null,
      idempotencyKey: null,
      requestFingerprintSha256: null,
      traceId: normalizedTraceId,
      requestedCapability: "knowledge",
      requestedScope: DEFAULT_REQUESTED_SCOPE,
      selectedTarget: input.response.selectedTarget,
      status,
      errorCode,
      questionPreview: "",
      answerPreview: previewText(assistantText),
      diagnostics,
      sourceDocIds,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      createdAt: input.startedAt,
      updatedAt: input.completedAt,
    },
    outboxEvent: {
      eventId: input.outboxEventId,
      requestId: input.requestId,
      eventType: outboxEventType,
      payload: {
        requestId: input.requestId,
        traceId: normalizedTraceId,
        conversationId: input.conversation.id,
        status,
        selectedTarget: input.response.selectedTarget,
        answerPreview: previewText(assistantText),
        errorCode,
        ...(diagnostics ? { diagnostics } : {}),
        sourceDocIds,
      },
      occurredAt: input.completedAt,
      availableAt: input.completedAt,
      processedAt: null,
      attemptCount: 0,
      lastError: null,
    },
  };

  return {
    responseBody: {
      answer: {
        conversation: toConversationResponse(input.conversation),
        result,
      },
      requestId: input.requestId,
      traceId: normalizedTraceId,
    },
    write,
  };
}

export function buildChatCommandService(
  dependencies: ChatCommandServiceDependencies,
): ChatCommandService {
  const computeFingerprint = dependencies.computeFingerprint ?? defaultComputeFingerprint;
  const generateId = dependencies.generateId ?? defaultGenerateId;
  const now = dependencies.now ?? (() => new Date());
  const telemetry = dependencies.telemetry;

  return {
    async submit(input) {
      if (!input.principal.permissions.chat) {
        throw createPreAcceptError({
          code: "forbidden",
          message: "Chat access is not available for this principal.",
          status: 403,
        });
      }

      const validatedPayload = resolveValidatedPayload(input.payload);
      const ownerUserId = input.principal.principal.principalId;

      let conversation: ChatConversation | null = null;
      let conversationDiscriminator = NEW_CONVERSATION_FINGERPRINT_SCOPE;

      if (validatedPayload.conversationId) {
        conversation = await dependencies.conversationStore.getConversationByOwner(
          ownerUserId,
          validatedPayload.conversationId,
        );
        if (!conversation) {
          throw createPreAcceptError({
            code: "conversation_not_found",
            message: "Conversation not found.",
            status: 404,
          });
        }
        conversationDiscriminator = conversation.id;
      }

      const idempotencyKey = input.idempotencyKey?.trim() || null;
      const requestFingerprintSha256 = idempotencyKey
        ? computeFingerprint({
            conversationDiscriminator,
            prompt: validatedPayload.prompt,
            requestedCapability: validatedPayload.requestedCapability,
            requestedScope: validatedPayload.requestedScope,
          })
        : null;

      if (idempotencyKey && requestFingerprintSha256) {
        const existing = await dependencies.store.findIdempotentRequest({
          actorUserId: input.principal.actor.userId,
          idempotencyKey,
        });
        if (existing) {
          if (existing.requestFingerprintSha256 !== requestFingerprintSha256) {
            throw createPreAcceptError({
              code: "idempotency_conflict",
              message: "Idempotency key conflicts with a different request.",
              status: 409,
            });
          }

          if (existing.status === "accepted") {
            throw createPreAcceptError({
              code: "request_in_progress",
              message: "A matching request is still in progress.",
              status: 409,
            });
          }

          return existing.response;
        }
      }

      const requestId = generateId("req");
      const traceId = generateId("trace");
      const acceptedAt = now().toISOString();
      const userMessageId = generateId("msg");
      const acceptedEventId = generateId("evt");

      let conversationSeed:
        | {
            id: string;
            ownerUserId: string;
            title: string;
            createdAt: string;
            updatedAt: string;
          }
        | undefined;

      if (!conversation) {
        const conversationId = generateId("conv");
        const title = buildConversationTitle(DRAFT_CONVERSATION_TITLE, validatedPayload.prompt);
        conversationSeed = {
          id: conversationId,
          ownerUserId,
          title,
          createdAt: acceptedAt,
          updatedAt: acceptedAt,
        };
        conversation = {
          id: conversationId,
          ownerUserId,
          title,
          createdAt: acceptedAt,
          updatedAt: acceptedAt,
          messages: [],
        };
      }

      const conversationTitle = buildConversationTitle(conversation.title, validatedPayload.prompt);
      const acceptedWrite = buildAcceptedWrite({
        conversation,
        conversationSeed,
        conversationTitle,
        idempotencyKey,
        now: acceptedAt,
        principal: input.principal,
        prompt: validatedPayload.prompt,
        requestFingerprintSha256,
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        traceId,
        userMessageId,
        outboxEventId: acceptedEventId,
      });

      telemetry?.configureChatRequestScope({
        actor: {
          principalType: input.principal.principal.type,
          subject: input.principal.actor.userId,
        },
        conversationId: conversation.id,
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        surface: "public_chat_web",
        traceId,
      });

      await dependencies.store.acceptRequest(acceptedWrite);

      await telemetry?.recordRequestAccepted({
        actor: {
          principalType: input.principal.principal.type,
          subject: input.principal.actor.userId,
        },
        conversationId: conversation.id,
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        status: "accepted",
        surface: "public_chat_web",
        traceId,
      });
      await telemetry?.recordProjectionEnqueued({
        conversationId: conversation.id,
        projectionStage: "accepted",
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        surface: "public_chat_web",
        traceId,
      });

      let transportError:
        | {
            code: string;
            retryable: boolean;
          }
        | null = null;
      let executionResponse: SupervisorExecutionResponse;

      try {
        executionResponse = await dependencies.supervisor.execute({
          context: buildSupervisorContextProjection({
            actor: input.principal.actor,
            authorization: input.principal.authorization,
            turnCount: conversation.messages.length,
          }),
          conversationId: conversation.id,
          requestId,
          requestedCapability: validatedPayload.requestedCapability,
          requestedScope: validatedPayload.requestedScope,
          traceHeaders: telemetry?.getTraceHeaders(),
          traceId,
          userGoal: validatedPayload.prompt,
        });
      } catch (error) {
        const handled = toHandledErrorTransportOutcome(error);
        transportError = {
          code: handled.error.code,
          retryable: handled.error.retryable ?? true,
        };
        executionResponse = handled;
      }

      if (transportError) {
        await telemetry?.recordRequestTransportError({
          conversationId: conversation.id,
          errorCode: transportError.code,
          requestId,
          requestedCapability: validatedPayload.requestedCapability,
          requestedScope: validatedPayload.requestedScope,
          retryable: transportError.retryable,
          surface: "public_chat_web",
          traceId,
        });
      }

      const completedAt = now().toISOString();
      const durationMs = Math.max(0, new Date(completedAt).valueOf() - new Date(acceptedAt).valueOf());
      const assistantMessageId = generateId("msg");
      const finalEventId = generateId("evt");
      const finalized = buildFinalizedWrite({
        assistantMessageId,
        completedAt,
        conversation,
        conversationTitle,
        durationMs,
        outboxEventId: finalEventId,
        requestId,
        response: executionResponse,
        startedAt: acceptedAt,
        traceId,
      });

      finalized.write.requestExecution.userMessageId = userMessageId;
      finalized.write.requestExecution.actorUserId = input.principal.actor.userId;
      finalized.write.requestExecution.actorPrincipalId = input.principal.actor.principalId;
      finalized.write.requestExecution.actorRoles = input.principal.actor.roles;
      finalized.write.requestExecution.actorDepartments = input.principal.actor.departments;
      finalized.write.requestExecution.actorGroups = input.principal.actor.groups;
      finalized.write.requestExecution.actorCampusScope = input.principal.actor.campusScope;
      finalized.write.requestExecution.principalType = input.principal.principal.type;
      finalized.write.requestExecution.principalLabel = input.principal.principal.displayName;
      finalized.write.requestExecution.entitlementSnapshotId =
        input.principal.authorization?.entitlementSnapshotId || null;
      finalized.write.requestExecution.entitlementGroups =
        input.principal.authorization?.entitlementGroups ?? [];
      finalized.write.requestExecution.visibilityScope =
        input.principal.authorization?.visibilityScope ?? null;
      finalized.write.requestExecution.applicabilityScope =
        input.principal.authorization?.applicabilityScope ?? null;
      finalized.write.requestExecution.idempotencyKey = idempotencyKey;
      finalized.write.requestExecution.requestFingerprintSha256 = requestFingerprintSha256;
      finalized.write.requestExecution.questionPreview = previewText(validatedPayload.prompt);
      finalized.write.requestExecution.requestedCapability = validatedPayload.requestedCapability;
      finalized.write.requestExecution.requestedScope = validatedPayload.requestedScope;

      const finalizedConversation = await dependencies.store.finalizeRequest(finalized.write);
      await telemetry?.recordProjectionEnqueued({
        conversationId: conversation.id,
        projectionStage: "finalized",
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        surface: "public_chat_web",
        traceId: finalized.write.requestExecution.traceId,
      });
      await telemetry?.recordRequestFinalized({
        conversationId: conversation.id,
        durationMs,
        errorCode: finalized.write.requestExecution.errorCode,
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        retryable: finalized.write.assistantMessage.retryable,
        selectedTarget: finalized.write.requestExecution.selectedTarget,
        sourceDocIds: finalized.write.requestExecution.sourceDocIds,
        status: finalized.write.requestExecution.status as
          | "completed"
          | "error"
          | "needs_clarification"
          | "no_answer"
          | "approval_required"
          | "rejected",
        surface: "public_chat_web",
        traceId: finalized.write.requestExecution.traceId,
      });

      return {
        ...finalized.responseBody,
        answer: {
          conversation: toConversationResponse(finalizedConversation),
          result: finalized.responseBody.answer.result,
        },
      };
    },
  };
}
