import { type ChatConversation, DRAFT_CONVERSATION_TITLE, toConversationResponse } from "../chat";
import type { SupervisorExecutionResponse } from "../integration";

import {
	buildAbuseThrottleRejectedResponse,
	createPreAcceptError,
	toHandledErrorTransportOutcome,
} from "./service/errors";
import {
	defaultComputeFingerprint,
	defaultGenerateId,
	deriveSafetyIdentifier,
	previewText,
	resolveValidatedPayload,
} from "./service/normalize";
import {
	type ChatCommandPayload,
	type ChatCommandResponse,
	type ChatCommandResult,
	type ChatCommandService,
	type ChatCommandServiceDependencies,
	NEW_CONVERSATION_FINGERPRINT_SCOPE,
} from "./service/types";
import {
	buildAcceptedWrite,
	buildConversationTitle,
	buildFinalizedWrite,
	buildSupervisorContextProjection,
} from "./service/writes";

export { deriveSafetyIdentifier } from "./service/normalize";
export type {
	ChatCommandPayload,
	ChatCommandResponse,
	ChatCommandResult,
	ChatCommandService,
	ChatCommandServiceDependencies,
} from "./service/types";

export function buildChatCommandService(
	dependencies: ChatCommandServiceDependencies,
): ChatCommandService {
	const computeFingerprint = dependencies.computeFingerprint ?? defaultComputeFingerprint;
	const deriveSafetyIdentifierForPrincipal =
		dependencies.deriveSafetyIdentifier ??
		((principal: Parameters<typeof deriveSafetyIdentifier>[0]) =>
			deriveSafetyIdentifier(principal, dependencies.safetyIdentifierHmacSecret ?? ""));
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
			const safetyIdentifier = deriveSafetyIdentifierForPrincipal(input.principal);
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
				safetyIdentifier,
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
				principalType: input.principal.principal.type,
				requestId,
				requestedCapability: validatedPayload.requestedCapability,
				requestedScope: validatedPayload.requestedScope,
				safetyIdentifier,
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
				principalType: input.principal.principal.type,
				requestId,
				requestedCapability: validatedPayload.requestedCapability,
				requestedScope: validatedPayload.requestedScope,
				safetyIdentifier,
				status: "accepted",
				surface,
				traceId,
			});
			await telemetry?.recordProjectionEnqueued({
				conversationId: conversation.id,
				principalType: input.principal.principal.type,
				projectionStage: "accepted",
				requestId,
				requestedCapability: validatedPayload.requestedCapability,
				requestedScope: validatedPayload.requestedScope,
				safetyIdentifier,
				surface,
				traceId,
			});

			const abuseControlState = safetyIdentifier
				? await dependencies.store.getAbuseControlState({
						now: acceptedAt,
						safetyIdentifier,
						surface,
					})
				: null;
			let transportError: {
				code: string;
				retryable: boolean;
			} | null = null;
			let executionResponse: SupervisorExecutionResponse;

			if (abuseControlState?.shouldThrottle) {
				executionResponse = buildAbuseThrottleRejectedResponse({
					traceId,
				});
			} else {
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
						safetyIdentifier,
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
			}

			if (transportError) {
				await telemetry?.recordRequestTransportError({
					conversationId: conversation.id,
					errorCode: transportError.code,
					principalType: input.principal.principal.type,
					requestId,
					requestedCapability: validatedPayload.requestedCapability,
					requestedScope: validatedPayload.requestedScope,
					safetyIdentifier,
					retryable: transportError.retryable,
					surface,
					traceId,
				});
			}

			const completedAt = now().toISOString();
			const durationMs = Math.max(
				0,
				new Date(completedAt).valueOf() - new Date(acceptedAt).valueOf(),
			);
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
				safetyIdentifier,
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
				principalType: input.principal.principal.type,
				projectionStage: "finalized",
				requestId,
				requestedCapability: validatedPayload.requestedCapability,
				requestedScope: validatedPayload.requestedScope,
				resolvedScope: finalized.write.requestExecution.resolvedScope,
				safetyIdentifier,
				surface,
				traceId: finalized.write.requestExecution.traceId,
			});
			await telemetry?.recordRequestFinalized({
				conversationId: conversation.id,
				durationMs,
				errorCode: finalized.write.requestExecution.errorCode,
				principalType: input.principal.principal.type,
				requestId,
				requestedCapability: validatedPayload.requestedCapability,
				requestedScope: validatedPayload.requestedScope,
				resolvedScope: finalized.write.requestExecution.resolvedScope,
				retryable: finalized.write.assistantMessage.retryable,
				safetyIdentifier,
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
