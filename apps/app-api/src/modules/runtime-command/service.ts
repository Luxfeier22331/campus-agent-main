import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import { buildExecutionAuthorizationContext, type ResolvedAppPrincipal } from "../auth";
import {
  DRAFT_CONVERSATION_TITLE,
  type ChatMessageStructuredPart,
  type ChatPlaceCard,
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
import {
  buildAcceptedRequestObservabilityFact,
  buildFinalizedRequestObservabilityFact,
} from "../request-observability";
import type { AppTelemetry } from "../telemetry";
import {
  buildSupervisorSessionProjection,
  deriveCurriculumSessionSlots,
} from "./curriculum-session";
import type {
  AcceptRequestWrite,
  ChatCommandStore,
  FinalizeRequestWrite,
  RequestExecutionStatus,
} from "./store";

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
  supervisor?: SupervisorExecutionResponse;
  traceId: string;
}

export interface ChatCommandService {
  submit(input: {
    idempotencyKey?: string | null;
    payload: ChatCommandPayload;
    principal: ResolvedAppPrincipal;
    surface?: string;
  }): Promise<ChatCommandResponse>;
}

export interface ChatCommandServiceDependencies {
  computeFingerprint?: (input: {
    conversationDiscriminator: string;
    prompt: string;
    requestedCapability: string;
    requestedScope: RequestedScope | null;
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
  requestedScope: RequestedScope | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => item !== null);
}

function normalizePointGeometry(value: unknown): ChatPlaceCard["pointGeometry"] {
  if (!isRecord(value)) {
    return null;
  }

  const longitude = typeof value.longitude === "number" ? value.longitude : null;
  const latitude = typeof value.latitude === "number" ? value.latitude : null;
  if (longitude === null || latitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function normalizePlaceRef(value: unknown): Pick<
  ChatPlaceCard,
  "campusArea" | "campusScope" | "displayName" | "entityType" | "placeId"
> | null {
  if (!isRecord(value)) {
    return null;
  }

  const placeId = normalizeOptionalString(value.place_id);
  const entityType = normalizeOptionalString(value.entity_type);
  const displayName = normalizeOptionalString(value.display_name);
  if (!placeId || !entityType || !displayName) {
    return null;
  }

  return {
    placeId,
    entityType,
    displayName,
    campusScope: normalizeOptionalString(value.campus_scope),
    campusArea: normalizeOptionalString(value.campus_area),
  };
}

function normalizePlaceCardPart(input: {
  selectedTarget: string | null;
  status: SupervisorExecutionResponse["status"];
  result: unknown;
}): ChatMessageStructuredPart[] {
  if (input.selectedTarget !== "navigation-specialist" || input.status !== "completed") {
    return [];
  }

  if (!isRecord(input.result)) {
    return [];
  }

  const placeCard = isRecord(input.result.place_card) ? input.result.place_card : null;
  if (!placeCard) {
    return [];
  }

  const place = normalizePlaceRef(placeCard.place);
  if (!place) {
    return [];
  }

  return [
    {
      type: "place_card",
      placeCard: {
        ...place,
        locationDescription: normalizeOptionalString(placeCard.location_description),
        landmarkHint: normalizeOptionalString(placeCard.landmark_hint),
        accessNote: normalizeOptionalString(placeCard.access_note),
        openingNote: normalizeOptionalString(placeCard.opening_note),
        serviceTags: normalizeStringArray(placeCard.service_tags),
        pointGeometry: normalizePointGeometry(placeCard.point_geometry),
        coordinateReferenceSystem: normalizeOptionalString(
          placeCard.coordinate_reference_system,
        ),
        sourceRefs: normalizeStringArray(placeCard.source_refs),
      },
    },
  ];
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
  sessionSlots: ChatConversation["sessionSlots"];
  turnCount: number;
}) {
  return {
    actor: input.actor,
    authorization: input.authorization ?? buildExecutionAuthorizationContext(input.actor),
    profileMemory: {
      items: [],
    },
    session: buildSupervisorSessionProjection({
      sessionSlots: input.sessionSlots,
      turnCount: input.turnCount,
    }),
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
  requestedScope: RequestedScope | null;
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

  const requestedScope = normalizeRequestedScope(payload.requestedScope);
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
  requestedScope: RequestedScope | null;
  surface: string;
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
    structuredParts: [],
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
      surface: input.surface,
      actorUserId: input.principal.actor.userId,
      actorPrincipalId: input.principal.actor.principalId,
      actorRoles: input.principal.actor.roles,
      actorDepartments: input.principal.actor.departments,
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
      resolvedScope: null,
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
    requestObservabilityFact: buildAcceptedRequestObservabilityFact({
      conversationId: input.conversation.id,
      principal: input.principal,
      requestId: input.requestId,
      requestedCapability: input.requestedCapability,
      requestedScope: input.requestedScope,
      resolvedScope: null,
      startedAt: input.now,
      surface: input.surface,
      traceId: input.traceId,
    }),
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
        surface: input.surface,
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
  principal: ResolvedAppPrincipal;
  requestId: string;
  requestedCapability: string;
  requestedScope: RequestedScope | null;
  response: SupervisorExecutionResponse;
  surface: string;
  startedAt: string;
  traceId: string;
}): {
  responseBody: ChatCommandResponse;
  write: FinalizeRequestWrite;
} {
  const normalizedTraceId = input.response.traceId || input.traceId;
  const normalizedSupervisorResponse = {
    ...input.response,
    traceId: normalizedTraceId,
  } satisfies SupervisorExecutionResponse;
  const diagnostics = extractRequestDiagnosticsSummary(input.response.result);
  const sourceDocIds = extractSourceDocIds(input.response.result);
  const structuredParts = normalizePlaceCardPart({
    result: input.response.result,
    selectedTarget: input.response.selectedTarget,
    status: input.response.status,
  });
  const resolvedScope = resolveFinalizedScope({
    requestedScope: input.requestedScope,
    response: normalizedSupervisorResponse,
  });

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
    structuredParts,
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
      surface: input.surface,
      actorUserId: input.conversation.ownerUserId,
      actorPrincipalId: input.conversation.ownerUserId,
      actorRoles: [],
      actorDepartments: [],
      principalType: input.principal.principal.type,
      principalLabel: null,
      entitlementSnapshotId: null,
      entitlementGroups: [],
      visibilityScope: null,
      applicabilityScope: null,
      idempotencyKey: null,
      requestFingerprintSha256: null,
      traceId: normalizedTraceId,
      requestedCapability: "knowledge",
      requestedScope: input.requestedScope,
      resolvedScope,
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
    requestObservabilityFact: buildFinalizedRequestObservabilityFact({
      completedAt: input.completedAt,
      conversationId: input.conversation.id,
      diagnostics,
      durationMs: input.durationMs,
      errorCode,
      principal: input.principal,
      requestId: input.requestId,
      requestedCapability: input.requestedCapability,
      requestedScope: input.requestedScope,
      resolvedScope,
      response: normalizedSupervisorResponse,
      sourceDocIds,
      startedAt: input.startedAt,
      status,
      surface: input.surface,
      traceId: normalizedTraceId,
    }),
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
    sessionSlots: deriveCurriculumSessionSlots({
      diagnostics,
      existingSlots: input.conversation.sessionSlots,
      finalizedAt: input.completedAt,
      status,
    }),
  };

  return {
    responseBody: {
      answer: {
        conversation: toConversationResponse(input.conversation),
        result,
      },
      requestId: input.requestId,
      supervisor: normalizedSupervisorResponse,
      traceId: normalizedTraceId,
    },
    write,
  };
}

function resolveFinalizedScope(input: {
  requestedScope: RequestedScope | null;
  response: SupervisorExecutionResponse;
}): RequestedScope | null {
  const corpus = input.response.observability?.resolvedScopeCorpus?.trim();
  const collection = input.response.observability?.resolvedScopeCollection?.trim();
  if (corpus && collection) {
    return { collection, corpus };
  }

  return input.requestedScope;
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

      const surface = input.surface?.trim() || "public_chat_web";
      const validatedPayload = resolveValidatedPayload(input.payload);
      const ownerUserId = input.principal.principal.principalId;

      let conversation: ChatConversation | null = null;
      let conversationDiscriminator = NEW_CONVERSATION_FINGERPRINT_SCOPE;

      if (validatedPayload.conversationId) {
        conversationDiscriminator = validatedPayload.conversationId;
        conversation = await dependencies.conversationStore.getConversationByOwner(
          ownerUserId,
          validatedPayload.conversationId,
        );
        if (conversation) {
          conversationDiscriminator = conversation.id;
        }
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
        const conversationId = validatedPayload.conversationId ?? generateId("conv");
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
          sessionSlots: [],
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
        surface,
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
        surface,
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
        surface,
        traceId,
      });
      await telemetry?.recordProjectionEnqueued({
        conversationId: conversation.id,
        projectionStage: "accepted",
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        surface,
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
            sessionSlots: conversation.sessionSlots,
            turnCount: conversation.messages.length,
          }),
          conversationId: conversation.id,
          requestId,
          requestedCapability: validatedPayload.requestedCapability,
          requestedScope: validatedPayload.requestedScope,
          surface,
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
          surface,
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
        principal: input.principal,
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        response: executionResponse,
        surface,
        startedAt: acceptedAt,
        traceId,
      });

      finalized.write.requestExecution.userMessageId = userMessageId;
      finalized.write.requestExecution.actorUserId = input.principal.actor.userId;
      finalized.write.requestExecution.actorPrincipalId = input.principal.actor.principalId;
      finalized.write.requestExecution.actorRoles = input.principal.actor.roles;
      finalized.write.requestExecution.actorDepartments = input.principal.actor.departments;
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
        resolvedScope: finalized.write.requestExecution.resolvedScope,
        surface,
        traceId: finalized.write.requestExecution.traceId,
      });
      await telemetry?.recordRequestFinalized({
        conversationId: conversation.id,
        durationMs,
        errorCode: finalized.write.requestExecution.errorCode,
        requestId,
        requestedCapability: validatedPayload.requestedCapability,
        requestedScope: validatedPayload.requestedScope,
        resolvedScope: finalized.write.requestExecution.resolvedScope,
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
        surface,
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
