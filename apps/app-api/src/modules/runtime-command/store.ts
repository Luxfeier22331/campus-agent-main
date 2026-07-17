import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	conversations,
	messages,
	profileMemorySettings,
	requestObservabilityFact,
	sessionSlots,
	turnDispatches,
} from "../../db/schema";
import { ABUSE_THROTTLE_TEN_MINUTE_WINDOW_MS } from "../abuse-throttle-policy";
import type { ChatConversation } from "../chat";
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
import type {
	AcceptedDurableRequestCloseout,
	ChatCommandStore,
	TurnDispatchMemorySnapshot,
} from "./store-types";
import { ChatFinalizationConflict } from "./store-types";

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
	FinalizeTurnDispatchWrite,
	RequestObservabilityFactWrite,
	StoredIdempotentRequest,
	TurnDispatchPrincipalSnapshot,
	TurnDispatchStatus,
	TurnDispatchWrite,
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
		async recordAdmissionInput(input) {
			const db = await getDb();
			const rows = await db
				.update(turnDispatches)
				.set({
					admissionStatus: "pending_admission",
					updatedAt: new Date(input.updatedAt),
					workflowId: input.workflowId,
					workflowInputJson: input.workflowInput,
					workflowInputSha256: input.workflowInputSha256,
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.admissionStatus, "pending_input"),
					),
				)
				.returning({ requestId: turnDispatches.requestId });
			return rows.length === 1;
		},

		async markAdmitted(input) {
			const db = await getDb();
			const rows = await db
				.update(turnDispatches)
				.set({
					admissionStatus: "admitted",
					admittedAt: new Date(input.admittedAt),
					workflowId: input.workflowId,
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.admissionStatus, "pending_admission"),
						eq(turnDispatches.workflowId, input.workflowId),
					),
				)
				.returning({ requestId: turnDispatches.requestId });
			return rows.length === 1;
		},
		async listPendingAdmissions(input = {}) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
			const rows = await db
				.select({
					requestId: turnDispatches.requestId,
					workflowId: turnDispatches.workflowId,
					workflowInput: turnDispatches.workflowInputJson,
					workflowInputSha256: turnDispatches.workflowInputSha256,
				})
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.status, "accepted"),
						eq(turnDispatches.admissionStatus, "pending_admission"),
						isNotNull(turnDispatches.workflowId),
						isNotNull(turnDispatches.workflowInputJson),
						isNotNull(turnDispatches.workflowInputSha256),
					),
				)
				.orderBy(asc(turnDispatches.updatedAt))
				.limit(limit);
			return rows.flatMap((row) =>
				row.workflowId && row.workflowInput && row.workflowInputSha256
					? [
							{
								requestId: row.requestId,
								workflowId: row.workflowId,
								workflowInput: row.workflowInput,
								workflowInputSha256: row.workflowInputSha256,
							},
						]
					: [],
			);
		},
		async listPreviousToolResultRefs(input) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit, 10));
			const rows = await db
				.select({
					answerText: messages.text,
					requestId: turnDispatches.requestId,
					runId: turnDispatches.runId,
					selectedTool: turnDispatches.selectedTool,
					status: turnDispatches.status,
					turnSequence: turnDispatches.turnSequence,
				})
				.from(turnDispatches)
				.leftJoin(
					messages,
					and(eq(messages.requestId, turnDispatches.requestId), eq(messages.role, "assistant")),
				)
				.where(
					and(
						eq(turnDispatches.ownerUserId, input.ownerUserId),
						eq(turnDispatches.conversationId, input.conversationId),
						eq(turnDispatches.status, "completed"),
						isNotNull(turnDispatches.runId),
						isNotNull(turnDispatches.selectedTool),
						lte(turnDispatches.turnSequence, input.beforeTurnSequence - 1),
					),
				)
				.orderBy(desc(turnDispatches.turnSequence))
				.limit(limit);
			return rows.flatMap((row) => {
				if (!(row.runId && row.selectedTool)) {
					return [];
				}
				const projectionRef = `projection://runs/${row.runId}/finalization`;
				return [
					{
						tool: row.selectedTool,
						contentHash: stableContextHash([
							row.requestId,
							row.runId,
							row.selectedTool,
							row.status,
							row.answerText ?? "",
						]),
						projectionRef,
						requestId: row.requestId,
						resultKind: "final_response",
						runId: row.runId,
						status: row.status,
						...(row.answerText ? { summary: row.answerText } : {}),
					},
				];
			});
		},

		async listAcceptedDurableRequestsForCloseout(input = {}) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
			const startedBefore = input.startedBefore ? new Date(input.startedBefore) : new Date();
			const runId = input.runId?.trim();
			const dispatchRows = await db
				.select()
				.from(turnDispatches)
				.where(
					and(
						...(runId ? [] : [eq(turnDispatches.status, "accepted")]),
						isNotNull(turnDispatches.runId),
						lte(turnDispatches.createdAt, startedBefore),
						...(runId ? [eq(turnDispatches.runId, runId)] : []),
					),
				)
				.orderBy(asc(turnDispatches.createdAt))
				.limit(limit);
			const candidates: AcceptedDurableRequestCloseout[] = [];
			for (const row of dispatchRows) {
				if (!row.runId) {
					continue;
				}
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
					requestedTool: row.requestedTool,
					runId: row.runId,
					safetyIdentifier: row.safetyIdentifier,
					surface: row.surface,
					traceId: row.traceId,
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
						.values(buildConversationSeedInsertValues(input.conversationSeed));
				}

				const lockedConversations = await tx
					.select({ id: conversations.id })
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
				if (!lockedConversations[0]) {
					throw new Error("Cannot accept a request for a missing or deleted conversation.");
				}

				let memorySnapshot: TurnDispatchMemorySnapshot | null = null;
				if (input.captureMemorySnapshot) {
					const settingsRows = await tx
						.select()
						.from(profileMemorySettings)
						.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
						.limit(1)
						.for("update");
					const settings = settingsRows[0];
					const lifecycleState = settings?.lifecycleState ?? "active";
					const syncStatus = settings?.syncStatus ?? "synced";
					memorySnapshot = {
						appendEnabled: lifecycleState === "active" && syncStatus === "synced",
						ownerGeneration: settings?.generation ?? 1,
						ownerSequence: settings?.commandSequence ?? 0,
						recallEnabled: lifecycleState === "active" && syncStatus === "synced",
					};
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
					.insert(turnDispatches)
					.values(buildAcceptTurnDispatchInsertValues(input.turnDispatch, memorySnapshot));

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
						activeRunId: input.userMessage.runId ?? null,
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
						finalizationFingerprint: turnDispatches.finalizationFingerprint,
						status: turnDispatches.status,
					})
					.from(turnDispatches)
					.where(eq(turnDispatches.requestId, input.turnDispatch.requestId))
					.limit(1)
					.for("update");
				const existing = existingRows[0];
				if (input.finalizationFingerprint && existing?.finalizationFingerprint) {
					if (existing.finalizationFingerprint !== input.finalizationFingerprint) {
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
						activeRunId: input.assistantMessage.runId ?? null,
						activeTurnSequence: input.turnDispatch.turnSequence,
					})
					.where(
						and(
							eq(conversations.id, input.assistantMessage.conversationId),
							eq(conversations.ownerUserId, input.ownerUserId),
							eq(conversations.activeTurnSequence, input.turnDispatch.turnSequence),
							input.turnDispatch.runId
								? eq(conversations.activeRunId, input.turnDispatch.runId)
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
					.insert(requestObservabilityFact)
					.values(buildRequestObservabilityFactInsertValues(input.requestObservabilityFact))
					.onConflictDoUpdate({
						set: buildRequestObservabilityFactUpdateValues(input.requestObservabilityFact),
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

			void replayed;
			return conversation;
		},
	};
}
