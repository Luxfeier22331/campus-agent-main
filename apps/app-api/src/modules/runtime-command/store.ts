import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	conversations,
	messages,
	projectionOutbox,
	requestExecution,
	requestObservabilityFact,
	sessionSlots,
} from "../../db/schema";
import type { AppPrincipalType } from "../auth";
import type { ChatConversation } from "../chat";
import { ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS } from "../safety-ops-policy";
import { createEmptyAbuseControlState, deriveAbuseControlState } from "./store-abuse";
import { buildStoredIdempotentRequest, toChatConversation } from "./store-conversation";
import {
	buildAcceptRequestExecutionInsertValues,
	buildChatMessageInsertValues,
	buildConversationSeedInsertValues,
	buildConversationTitleUpdateValues,
	buildFinalizeRequestExecutionUpdateValues,
	buildProjectionOutboxInsertValues,
	buildRequestObservabilityFactInsertValues,
	buildRequestObservabilityFactUpdateValues,
	buildSessionSlotInsertValues,
} from "./store-mutations";
import type { AcceptedDurableRequestCloseout, ChatCommandStore } from "./store-types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function stableContextHash(values: string[]): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`;
}

export type {
	AbuseControlState,
	AcceptedDurableRequestCloseout,
	AcceptRequestWrite,
	ChatCommandStore,
	FinalizeRequestWrite,
	ProjectionOutboxWrite,
	RequestExecutionStatus,
	RequestExecutionWrite,
	RequestObservabilityFactWrite,
	StoredIdempotentRequest,
} from "./store-types";

export function createPgChatCommandStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): ChatCommandStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	async function loadConversation(
		ownerUserId: string,
		conversationId: string,
	): Promise<ChatConversation | null> {
		const db = await getDb();
		const conversationRows = await db
			.select()
			.from(conversations)
			.where(and(eq(conversations.id, conversationId), eq(conversations.ownerUserId, ownerUserId)))
			.limit(1);
		const conversationRow = conversationRows[0];
		if (!conversationRow) {
			return null;
		}

		const messageRows = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(asc(messages.createdAt));
		const sessionSlotRows = await db
			.select()
			.from(sessionSlots)
			.where(eq(sessionSlots.conversationId, conversationId))
			.orderBy(asc(sessionSlots.name));

		return toChatConversation(conversationRow, messageRows, sessionSlotRows);
	}

	return {
		async listPreviousCapabilityResultRefs(input) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit, 10));
			const rows = await db
				.select({
					answerPreview: requestExecution.answerPreview,
					requestId: requestExecution.requestId,
					runId: requestExecution.runId,
					selectedCapability: requestExecution.selectedCapability,
					status: requestExecution.status,
					turnSequence: requestExecution.turnSequence,
				})
				.from(requestExecution)
				.where(
					and(
						eq(requestExecution.actorUserId, input.ownerUserId),
						eq(requestExecution.conversationId, input.conversationId),
						eq(requestExecution.status, "completed"),
						isNotNull(requestExecution.runId),
						isNotNull(requestExecution.selectedCapability),
						lte(requestExecution.turnSequence, input.beforeTurnSequence - 1),
					),
				)
				.orderBy(desc(requestExecution.turnSequence))
				.limit(limit);
			return rows.flatMap((row) => {
				if (!(row.runId && row.selectedCapability)) {
					return [];
				}
				const projectionRef = `projection://runs/${row.runId}/finalization`;
				return [
					{
						capability: row.selectedCapability,
						contentHash: stableContextHash([
							row.requestId,
							row.runId,
							row.selectedCapability,
							row.status,
							row.answerPreview ?? "",
						]),
						projectionRef,
						requestId: row.requestId,
						resultKind: "final_response",
						runId: row.runId,
						status: row.status,
						...(row.answerPreview ? { summary: row.answerPreview } : {}),
					},
				];
			});
		},

		async listAcceptedDurableRequestsForCloseout(input = {}) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
			const startedBefore = input.startedBefore ? new Date(input.startedBefore) : new Date();
			const runId = input.runId?.trim();
			const executionRows = await db
				.select()
				.from(requestExecution)
				.where(
					and(
						eq(requestExecution.status, "accepted"),
						isNotNull(requestExecution.runId),
						lte(requestExecution.startedAt, startedBefore),
						...(runId ? [eq(requestExecution.runId, runId)] : []),
					),
				)
				.orderBy(asc(requestExecution.startedAt))
				.limit(limit);
			const candidates: AcceptedDurableRequestCloseout[] = [];
			for (const row of executionRows) {
				if (!row.runId) {
					continue;
				}
				const conversation = await loadConversation(row.actorUserId, row.conversationId);
				if (!conversation) {
					continue;
				}
				candidates.push({
					acceptedAt: row.startedAt.toISOString(),
					conversation,
					conversationTitle: conversation.title,
					idempotencyKey: row.idempotencyKey,
					principal: {
						actor: {
							departments: row.actorDepartmentsJson,
							principalId: row.actorPrincipalId,
							principalType: row.principalType as AppPrincipalType,
							roles: row.actorRolesJson,
							userId: row.actorUserId,
						},
						authorization: {
							...(row.applicabilityScope ? { applicabilityScope: row.applicabilityScope } : {}),
							approvalState: "not_required",
							entitlementGroups: row.entitlementGroupsJson,
							entitlementSnapshotId: row.entitlementSnapshotId ?? "",
							ownershipScopes: [`conversation:${row.actorUserId}`],
							principalId: row.actorPrincipalId,
							projectionSource: "campus_identity",
							retrievalFilter: {
								entitlementGroups: row.entitlementGroupsJson,
								policyProjectionVersion: "phase1-authorization-projection-v1",
								visibilityLevel: "public",
								visibilityScope: row.visibilityScope ?? "main",
							},
							visibilityScope: row.visibilityScope,
						},
						permissions: {
							chat: true,
							operator: row.actorRolesJson.includes("operator"),
						},
						principal: {
							displayName: row.principalLabel ?? row.actorPrincipalId,
							email: null,
							principalId: row.actorPrincipalId,
							type: row.principalType as AppPrincipalType,
						},
						session: null,
					},
					questionPreview: row.questionPreview,
					requestFingerprintSha256: row.requestFingerprintSha256,
					requestId: row.requestId,
					requestedCapability: row.requestedCapability,
					requestedScope:
						row.requestedScopeJson as AcceptedDurableRequestCloseout["requestedScope"],
					runId: row.runId,
					safetyIdentifier: row.safetyIdentifier,
					surface: row.surface,
					traceId: row.traceId,
					turnSequence: row.turnSequence,
					userMessageId: row.userMessageId,
					versionQuery: row.versionQueryJson,
				});
			}
			return candidates;
		},

		async findIdempotentRequest(input) {
			const db = await getDb();
			const executionRows = await db
				.select()
				.from(requestExecution)
				.where(
					and(
						eq(requestExecution.actorUserId, input.actorUserId),
						eq(requestExecution.idempotencyKey, input.idempotencyKey),
					),
				)
				.limit(1);
			const executionRow = executionRows[0];
			if (!executionRow) {
				return null;
			}

			const conversation = await loadConversation(input.actorUserId, executionRow.conversationId);
			if (!conversation) {
				return null;
			}

			const assistantRows = await db
				.select()
				.from(messages)
				.where(eq(messages.requestId, executionRow.requestId))
				.orderBy(desc(messages.createdAt))
				.limit(1);
			return buildStoredIdempotentRequest({
				assistantMessageRow: assistantRows[0] ?? null,
				conversation,
				executionRow,
			});
		},

		async getAbuseControlState(input) {
			const safetyIdentifier = input.safetyIdentifier.trim();
			const surface = input.surface.trim();
			if (!(safetyIdentifier && surface)) {
				return createEmptyAbuseControlState();
			}

			const db = await getDb();
			const tenMinutesAgo = new Date(
				new Date(input.now).valueOf() - ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS,
			);
			const rows = await db
				.select({
					errorCode: requestExecution.errorCode,
					startedAt: requestExecution.startedAt,
				})
				.from(requestExecution)
				.where(
					and(
						eq(requestExecution.safetyIdentifier, safetyIdentifier),
						eq(requestExecution.surface, surface),
						gte(requestExecution.startedAt, tenMinutesAgo),
					),
				);
			return deriveAbuseControlState({
				now: input.now,
				rows,
			});
		},

		async acceptRequest(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				if (input.conversationSeed) {
					await tx
						.insert(conversations)
						.values(buildConversationSeedInsertValues(input.conversationSeed));
				}

				await tx
					.update(messages)
					.set({ isActiveBranchHead: false })
					.where(
						and(
							eq(messages.conversationId, input.userMessage.conversationId),
							eq(messages.branchId, input.userMessage.branchId ?? "branch_active"),
							eq(messages.isActiveBranchHead, true),
						),
					);

				await tx.insert(messages).values(buildChatMessageInsertValues(input.userMessage));

				await tx
					.insert(requestExecution)
					.values(buildAcceptRequestExecutionInsertValues(input.requestExecution));

				await tx
					.insert(projectionOutbox)
					.values(buildProjectionOutboxInsertValues(input.outboxEvent));

				await tx
					.insert(requestObservabilityFact)
					.values(buildRequestObservabilityFactInsertValues(input.requestObservabilityFact));

				await tx
					.update(conversations)
					.set({
						...buildConversationTitleUpdateValues({
							title: input.conversationTitle,
							updatedAt: input.userMessage.createdAt,
						}),
						activeBranchId: input.userMessage.branchId ?? "branch_active",
						activeMessageId: input.userMessage.id,
						activeRunId: input.userMessage.runId ?? null,
						activeTurnSequence: input.requestExecution.turnSequence,
					})
					.where(
						and(
							eq(conversations.id, input.userMessage.conversationId),
							eq(conversations.ownerUserId, input.ownerUserId),
						),
					);
			});
		},

		async finalizeRequest(input) {
			const db = await getDb();
			let activeStateAdvanced = false;
			await db.transaction(async (tx) => {
				const finalizedRequestRows = await tx
					.update(requestExecution)
					.set(buildFinalizeRequestExecutionUpdateValues(input.requestExecution))
					.where(
						and(
							eq(requestExecution.requestId, input.requestExecution.requestId),
							eq(requestExecution.status, "accepted"),
						),
					)
					.returning({ requestId: requestExecution.requestId });
				if (finalizedRequestRows.length !== 1) {
					throw new Error(
						`Cannot finalize request ${input.requestExecution.requestId} because it is not in accepted status.`,
					);
				}

				const activeUpdateRows = await tx
					.update(conversations)
					.set({
						...buildConversationTitleUpdateValues({
							title: input.conversationTitle,
							updatedAt: input.assistantMessage.createdAt,
						}),
						activeBranchId: input.assistantMessage.branchId ?? "branch_active",
						activeMessageId: input.assistantMessage.id,
						activeRunId: input.assistantMessage.runId ?? null,
						activeTurnSequence: input.requestExecution.turnSequence,
						contextSummary: input.contextSummary,
					})
					.where(
						and(
							eq(conversations.id, input.assistantMessage.conversationId),
							eq(conversations.ownerUserId, input.ownerUserId),
							eq(conversations.activeTurnSequence, input.requestExecution.turnSequence),
							input.requestExecution.runId
								? eq(conversations.activeRunId, input.requestExecution.runId)
								: isNull(conversations.activeRunId),
						),
					)
					.returning({ id: conversations.id });
				activeStateAdvanced = activeUpdateRows.length === 1;

				if (activeStateAdvanced) {
					await tx
						.update(messages)
						.set({ isActiveBranchHead: false })
						.where(
							and(
								eq(messages.conversationId, input.assistantMessage.conversationId),
								eq(messages.branchId, input.assistantMessage.branchId ?? "branch_active"),
								eq(messages.isActiveBranchHead, true),
							),
						);
				}

				await tx.insert(messages).values(
					buildChatMessageInsertValues({
						...input.assistantMessage,
						isActiveBranchHead: activeStateAdvanced,
					}),
				);

				await tx
					.insert(projectionOutbox)
					.values(buildProjectionOutboxInsertValues(input.outboxEvent));

				await tx
					.insert(requestObservabilityFact)
					.values(buildRequestObservabilityFactInsertValues(input.requestObservabilityFact))
					.onConflictDoUpdate({
						set: buildRequestObservabilityFactUpdateValues(input.requestObservabilityFact),
						target: requestObservabilityFact.requestId,
					});

				if (activeStateAdvanced) {
					await tx
						.delete(sessionSlots)
						.where(eq(sessionSlots.conversationId, input.requestExecution.conversationId));
				}

				if (activeStateAdvanced && input.sessionSlots.length > 0) {
					await tx.insert(sessionSlots).values(
						buildSessionSlotInsertValues({
							conversationId: input.requestExecution.conversationId,
							sessionSlots: input.sessionSlots,
						}),
					);
				}
			});

			const conversation = await loadConversation(
				input.ownerUserId,
				input.requestExecution.conversationId,
			);
			if (!conversation) {
				throw new Error("Conversation disappeared after finalize.");
			}

			return conversation;
		},
	};
}
