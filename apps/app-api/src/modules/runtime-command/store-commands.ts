import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import type { RuntimeDbGetter } from "../../db/runtime";
import {
	conversations,
	messages,
	requestObservabilityFact,
	sessionSlots,
	turnDispatches,
} from "../../db/schema";
import { ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS } from "../abuse-throttle-policy";
import type { ChatConversation } from "../chat";
import { captureProfileMemorySnapshotForUpdate } from "../profile-memory/snapshot";
import { createEmptyAbuseControlState, deriveAbuseControlState } from "./store-abuse";
import { buildStoredIdempotentRequest, toChatConversation } from "./store-conversation";
import {
	buildAcceptTurnDispatchInsertValues,
	buildChatMessageInsertValues,
	buildConversationSeedInsertValues,
	buildConversationTitleUpdateValues,
	buildFinalizeTurnDispatchUpdateValues,
	buildRequestObservabilityFactInsertValues,
	buildRequestObservabilityFactUpdateValues,
	buildSessionSlotInsertValues,
} from "./store-mutations";
import { withStreamOrchestrationOverhead } from "./store-observability-timing";
import type {
	AcceptedChatCommandStore,
	AcceptedDurableRequestCloseout,
	TurnDispatchMemorySnapshot,
} from "./store-types";
import {
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
	ChatFinalizationConflict,
} from "./store-types";

export function createPgAcceptedChatCommandStore(getDb: RuntimeDbGetter): AcceptedChatCommandStore {
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

	const persistence = {
		async readDurableRunInput(requestId) {
			const normalizedRequestId = requestId.trim();
			if (!normalizedRequestId) {
				return null;
			}
			const db = await getDb();
			const rows = await db
				.select({
					conversationId: turnDispatches.conversationId,
					executionInputJson: turnDispatches.executionInputJson,
					executionInputSha256: turnDispatches.executionInputSha256,
					memoryRecallEnabled: turnDispatches.memoryRecallEnabled,
					ownerUserId: turnDispatches.ownerUserId,
					requestId: turnDispatches.requestId,
					surface: turnDispatches.surface,
					status: turnDispatches.status,
				})
				.from(turnDispatches)
				.where(eq(turnDispatches.requestId, normalizedRequestId))
				.limit(1);
			const row = rows[0];
			if (!row) {
				return null;
			}
			return {
				conversationId: row.conversationId,
				executionInputJson: row.executionInputJson,
				executionInputSha256: row.executionInputSha256,
				memoryRecallEnabled: row.memoryRecallEnabled,
				ownerUserId: row.ownerUserId,
				requestId: row.requestId,
				surface: row.surface,
				status: row.status as import("./store-types").TurnDispatchStatus,
			};
		},

		async listAcceptedDurableRequestsForCloseout(input = {}) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
			const startedBefore = input.startedBefore ? new Date(input.startedBefore) : new Date();
			const requestId = input.requestId?.trim();
			const dispatchRows = await db
				.select()
				.from(turnDispatches)
				.where(
					and(
						...(requestId ? [] : [eq(turnDispatches.status, "accepted")]),
						lte(turnDispatches.createdAt, startedBefore),
						...(requestId ? [eq(turnDispatches.requestId, requestId)] : []),
					),
				)
				.orderBy(asc(turnDispatches.createdAt))
				.limit(limit);
			const candidates: AcceptedDurableRequestCloseout[] = [];
			for (const row of dispatchRows) {
				const conversation = await loadConversation(row.ownerUserId, row.conversationId);
				if (!conversation) {
					continue;
				}
				const userMessage = conversation.messages.find(
					(message) => message.id === row.userMessageId,
				);
				if (!userMessage) {
					continue;
				}
				const principalSnapshot = row.principalSnapshotJson;
				candidates.push({
					acceptedAt: row.createdAt.toISOString(),
					assistantMessageId: row.assistantMessageId,
					completedAt: row.completedAt?.toISOString() ?? null,
					conversation,
					conversationTitle: conversation.title,
					idempotencyKey: row.idempotencyKey,
					principal: {
						actor: principalSnapshot.actor,
						...(principalSnapshot.authorization
							? { authorization: principalSnapshot.authorization }
							: {}),
						permissions: {
							chat: true,
						},
						principal: {
							displayName: principalSnapshot.principal.displayName,
							email: null,
							principalId: principalSnapshot.principal.principalId,
							type: principalSnapshot.principal.type,
						},
						session: null,
					},
					questionPreview: userMessage.text,
					requestFingerprintSha256: row.requestFingerprintSha256,
					requestId: row.requestId,
					safetyIdentifier: row.safetyIdentifier,
					surface: row.surface,
					turnSequence: row.turnSequence,
					userMessageId: row.userMessageId,
					finalizationFingerprint: row.finalizationFingerprint,
				});
			}
			return candidates;
		},

		async findIdempotentRequest(input) {
			const db = await getDb();
			const dispatchRows = await db
				.select()
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.actorUserId, input.actorUserId),
						eq(turnDispatches.idempotencyKey, input.idempotencyKey),
					),
				)
				.limit(1);
			const dispatchRow = dispatchRows[0];
			if (!dispatchRow) {
				return null;
			}

			const conversation = await loadConversation(
				dispatchRow.ownerUserId,
				dispatchRow.conversationId,
			);
			if (!conversation) {
				return null;
			}

			const assistantRows = await db
				.select()
				.from(messages)
				.where(eq(messages.requestId, dispatchRow.requestId))
				.orderBy(desc(messages.createdAt))
				.limit(1);
			return buildStoredIdempotentRequest({
				assistantMessageRow: assistantRows[0] ?? null,
				conversation,
				dispatchRow,
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
					errorCode: turnDispatches.errorCode,
					startedAt: turnDispatches.createdAt,
				})
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.safetyIdentifier, safetyIdentifier),
						eq(turnDispatches.surface, surface),
						gte(turnDispatches.createdAt, tenMinutesAgo),
					),
				);
			return deriveAbuseControlState({
				now: input.now,
				rows,
			});
		},

		async acceptRequest(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				if (input.conversationSeed) {
					await tx
						.insert(conversations)
						.values(buildConversationSeedInsertValues(input.conversationSeed))
						.onConflictDoNothing({ target: conversations.id });
				}

				const lockedConversations = await tx
					.select({
						activeBranchId: conversations.activeBranchId,
						activeMessageId: conversations.activeMessageId,
						activeRequestId: conversations.activeRequestId,
						activeTurnSequence: conversations.activeTurnSequence,
						id: conversations.id,
						updatedAt: conversations.updatedAt,
					})
					.from(conversations)
					.where(
						and(
							eq(conversations.id, input.userMessage.conversationId),
							eq(conversations.ownerUserId, input.ownerUserId),
							isNull(conversations.deletedAt),
						),
					)
					.limit(1)
					.for("update");
				const lockedConversation = lockedConversations[0];
				if (!lockedConversation) {
					throw new ChatAcceptanceConversationConflict();
				}
				if (
					lockedConversation.activeBranchId !== input.conversationBaseline.activeBranchId ||
					lockedConversation.activeMessageId !== input.conversationBaseline.activeMessageId ||
					lockedConversation.activeRequestId !== input.conversationBaseline.activeRequestId ||
					lockedConversation.activeTurnSequence !== input.conversationBaseline.activeTurnSequence ||
					lockedConversation.updatedAt.toISOString() !== input.conversationBaseline.updatedAt
				) {
					if (input.turnDispatch.idempotencyKey) {
						const idempotencyWinner = await tx
							.select({ requestId: turnDispatches.requestId })
							.from(turnDispatches)
							.where(
								and(
									eq(turnDispatches.actorUserId, input.turnDispatch.actorUserId),
									eq(turnDispatches.idempotencyKey, input.turnDispatch.idempotencyKey),
								),
							)
							.limit(1);
						if (idempotencyWinner[0]) {
							throw new ChatAcceptanceIdempotencyConflict();
						}
					}
					throw new ChatAcceptanceConversationConflict();
				}

				const memorySnapshot: TurnDispatchMemorySnapshot | null =
					input.requestKind === "public_chat"
						? await captureProfileMemorySnapshotForUpdate(tx, input.ownerUserId)
						: null;
				const frozenRun = input.freezeDurableRun(memorySnapshot);

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

				const acceptedDispatchRows = await tx
					.insert(turnDispatches)
					.values(
						buildAcceptTurnDispatchInsertValues(input.turnDispatch, memorySnapshot, frozenRun),
					)
					.onConflictDoNothing({
						target: [turnDispatches.actorUserId, turnDispatches.idempotencyKey],
					})
					.returning({ requestId: turnDispatches.requestId });
				if (acceptedDispatchRows.length !== 1) {
					throw new ChatAcceptanceIdempotencyConflict();
				}

				await tx
					.insert(requestObservabilityFact)
					.values(buildRequestObservabilityFactInsertValues(input.requestObservabilityFact));

				const updatedConversations = await tx
					.update(conversations)
					.set({
						...buildConversationTitleUpdateValues({
							title: input.conversationTitle,
							updatedAt: input.userMessage.createdAt,
						}),
						activeBranchId: input.userMessage.branchId ?? "branch_active",
						activeMessageId: input.userMessage.id,
						activeRequestId: input.turnDispatch.requestId,
						activeTurnSequence: input.turnDispatch.turnSequence,
					})
					.where(
						and(
							eq(conversations.id, input.userMessage.conversationId),
							eq(conversations.ownerUserId, input.ownerUserId),
							isNull(conversations.deletedAt),
						),
					)
					.returning({ id: conversations.id });
				if (updatedConversations.length !== 1) {
					throw new Error("Conversation changed while accepting the request.");
				}
				return { memorySnapshot };
			});
		},

		async finalizeRequest(input) {
			const db = await getDb();
			let activeStateAdvanced = false;
			let replayed = false;
			await db.transaction(async (tx) => {
				const existingRows = await tx
					.select({
						completedAt: turnDispatches.completedAt,
						finalizationFingerprint: turnDispatches.finalizationFingerprint,
						status: turnDispatches.status,
					})
					.from(turnDispatches)
					.where(eq(turnDispatches.requestId, input.turnDispatch.requestId))
					.limit(1)
					.for("update");
				const existing = existingRows[0];
				if (
					input.finalizationFingerprint &&
					(existing?.finalizationFingerprint || existing?.completedAt)
				) {
					const requestedCompletedAt = input.turnDispatch.completedAt
						? new Date(input.turnDispatch.completedAt)
						: null;
					if (
						!(existing.finalizationFingerprint && existing.completedAt && requestedCompletedAt) ||
						Number.isNaN(requestedCompletedAt.valueOf()) ||
						existing.finalizationFingerprint !== input.finalizationFingerprint ||
						existing.completedAt.valueOf() !== requestedCompletedAt.valueOf()
					) {
						throw new ChatFinalizationConflict();
					}
					replayed = true;
					return;
				}
				const finalizedDispatchRows = await tx
					.update(turnDispatches)
					.set({
						...buildFinalizeTurnDispatchUpdateValues(input.turnDispatch),
						finalizationFingerprint: input.finalizationFingerprint ?? null,
					})
					.where(
						and(
							eq(turnDispatches.requestId, input.turnDispatch.requestId),
							eq(turnDispatches.status, "accepted"),
						),
					)
					.returning({ requestId: turnDispatches.requestId });
				if (finalizedDispatchRows.length !== 1) {
					throw new Error(
						`Cannot finalize request ${input.turnDispatch.requestId} because it is not in accepted status.`,
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
						activeRequestId: input.turnDispatch.requestId,
						activeTurnSequence: input.turnDispatch.turnSequence,
					})
					.where(
						and(
							eq(conversations.id, input.assistantMessage.conversationId),
							eq(conversations.ownerUserId, input.ownerUserId),
							eq(conversations.activeTurnSequence, input.turnDispatch.turnSequence),
							eq(conversations.activeRequestId, input.turnDispatch.requestId),
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

				const mergedStageTiming = sql<Record<string, unknown>>`${
					requestObservabilityFact.stageTimingJson
				} || excluded.stage_timing_json`;
				await tx
					.insert(requestObservabilityFact)
					.values(buildRequestObservabilityFactInsertValues(input.requestObservabilityFact))
					.onConflictDoUpdate({
						set: {
							...buildRequestObservabilityFactUpdateValues(input.requestObservabilityFact),
							stageTimingJson: withStreamOrchestrationOverhead(mergedStageTiming),
							updatedAt: sql<Date>`greatest(
								${requestObservabilityFact.updatedAt},
								excluded.updated_at
							)`,
						},
						target: requestObservabilityFact.requestId,
					});

				if (activeStateAdvanced && input.sessionSlots.length > 0) {
					await tx.delete(sessionSlots).where(
						and(
							eq(sessionSlots.conversationId, input.assistantMessage.conversationId),
							inArray(
								sessionSlots.name,
								input.sessionSlots.map((slot) => slot.name),
							),
						),
					);
				}

				if (activeStateAdvanced && input.sessionSlots.length > 0) {
					await tx.insert(sessionSlots).values(
						buildSessionSlotInsertValues({
							conversationId: input.assistantMessage.conversationId,
							sessionSlots: input.sessionSlots,
						}),
					);
				}
			});

			const conversation = await loadConversation(
				input.ownerUserId,
				input.assistantMessage.conversationId,
			);
			if (!conversation) {
				throw new Error("Conversation disappeared after finalize.");
			}

			return {
				conversation,
				outcome: replayed ? "replayed" : "applied",
			};
		},
	} satisfies AcceptedChatCommandStore;
	return persistence;
}
