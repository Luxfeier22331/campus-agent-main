import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

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
import { isProfileMemoryRuntimeEnabled } from "../profile-memory/model";
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
import {
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
	ChatFinalizationConflict,
} from "./store-types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function withStreamOrchestrationOverhead(
	timing: SQL<Record<string, unknown>>,
): SQL<Record<string, unknown>> {
	return sql<Record<string, unknown>>`case
		when jsonb_typeof(${timing} -> 'stream.app_api_ttft_ms') = 'number'
			and jsonb_typeof(${timing} -> 'agent.first_delta_ms') = 'number'
			and (${timing} ->> 'stream.app_api_ttft_ms')::double precision >= 0
			and (${timing} ->> 'agent.first_delta_ms')::double precision >= 0
			and (${timing} ->> 'agent.first_delta_ms')::double precision
				<= (${timing} ->> 'stream.app_api_ttft_ms')::double precision
		then jsonb_set(
			${timing},
			array['stream.orchestration_overhead_ms'],
			to_jsonb(
				(${timing} ->> 'stream.app_api_ttft_ms')::double precision
					- (${timing} ->> 'agent.first_delta_ms')::double precision
			),
			true
		)
		else ${timing}
	end`;
}

export type {
	AbuseControlState,
	AcceptedDurableRequestCloseout,
	AcceptRequestWrite,
	ChatCommandStore,
	FinalizeRequestResult,
	FinalizeRequestWrite,
	FinalizeTurnDispatchWrite,
	FrozenChatAdmissionWrite,
	RequestObservabilityFactWrite,
	StoredIdempotentRequest,
	TurnDispatchMemorySnapshot,
	TurnDispatchPrincipalSnapshot,
	TurnDispatchStatus,
	TurnDispatchWrite,
} from "./store-types";
export {
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
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
		async claimAdmission(input) {
			const db = await getDb();
			const admissionCondition = input.staleBefore
				? or(
						eq(turnDispatches.admissionStatus, "pending_admission"),
						and(
							eq(turnDispatches.admissionStatus, "dispatching"),
							lt(turnDispatches.updatedAt, new Date(input.staleBefore)),
						),
					)
				: eq(turnDispatches.admissionStatus, "pending_admission");
			const rows = await db
				.update(turnDispatches)
				.set({
					admissionStatus: "dispatching",
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.workflowId, input.workflowId),
						eq(turnDispatches.status, "accepted"),
						admissionCondition,
						inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
					),
				)
				.returning({ requestId: turnDispatches.requestId });
			return rows.length === 1;
		},

		async releaseAdmission(input) {
			const db = await getDb();
			const rows = await db
				.update(turnDispatches)
				.set({
					admissionStatus: sql<string>`case
						when ${turnDispatches.cancelOutboxStatus} in ('local_finalization_pending', 'closed')
							then 'cancelled'
						else 'pending_admission'
					end`,
					updatedAt: new Date(input.updatedAt),
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.workflowId, input.workflowId),
						eq(turnDispatches.status, "accepted"),
						eq(turnDispatches.admissionStatus, "dispatching"),
						inArray(turnDispatches.cancelOutboxStatus, [
							"not_requested",
							"pending_delivery",
							"local_finalization_pending",
						]),
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
					admissionInputJson: null,
					admissionInputSha256: null,
					admittedAt: new Date(input.admittedAt),
					workflowId: input.workflowId,
				})
				.where(
					and(
						eq(turnDispatches.requestId, input.requestId),
						eq(turnDispatches.status, "accepted"),
						inArray(turnDispatches.admissionStatus, ["dispatching", "admitted"]),
						eq(turnDispatches.workflowId, input.workflowId),
						inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
					),
				)
				.returning({ requestId: turnDispatches.requestId });
			return rows.length === 1;
		},
		async listPendingAdmissions(input = {}) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
			const admissionCondition = input.staleBefore
				? or(
						and(
							eq(turnDispatches.admissionStatus, "pending_admission"),
							inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
						),
						and(
							eq(turnDispatches.admissionStatus, "dispatching"),
							lt(turnDispatches.updatedAt, new Date(input.staleBefore)),
							inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
						),
					)
				: and(
						eq(turnDispatches.admissionStatus, "pending_admission"),
						inArray(turnDispatches.cancelOutboxStatus, ["not_requested", "pending_delivery"]),
					);
			const rows = await db
				.select({
					admissionInputJson: turnDispatches.admissionInputJson,
					admissionInputSha256: turnDispatches.admissionInputSha256,
					requestId: turnDispatches.requestId,
					runId: turnDispatches.runId,
					workflowId: turnDispatches.workflowId,
				})
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.status, "accepted"),
						admissionCondition,
						isNotNull(turnDispatches.workflowId),
						isNotNull(turnDispatches.runId),
						isNotNull(turnDispatches.admissionInputJson),
						isNotNull(turnDispatches.admissionInputSha256),
					),
				)
				.orderBy(asc(turnDispatches.updatedAt))
				.limit(limit);
			return rows.flatMap((row) =>
				row.workflowId && row.runId && row.admissionInputJson && row.admissionInputSha256
					? [
							{
								admissionInputJson: row.admissionInputJson,
								admissionInputSha256: row.admissionInputSha256,
								requestId: row.requestId,
								runId: row.runId,
								workflowId: row.workflowId,
							},
						]
					: [],
			);
		},
		async readExecutionInput(runId) {
			const normalizedRunId = runId.trim();
			if (!normalizedRunId) {
				return null;
			}
			const db = await getDb();
			const rows = await db
				.select({
					executionInputJson: turnDispatches.executionInputJson,
					executionInputSha256: turnDispatches.executionInputSha256,
					requestId: turnDispatches.requestId,
					runId: turnDispatches.runId,
					status: turnDispatches.status,
				})
				.from(turnDispatches)
				.where(eq(turnDispatches.runId, normalizedRunId))
				.limit(1);
			const row = rows[0];
			if (!row?.runId) {
				return null;
			}
			return {
				executionInputJson: row.executionInputJson,
				executionInputSha256: row.executionInputSha256,
				requestId: row.requestId,
				runId: row.runId,
				status: row.status as import("./store-types").TurnDispatchStatus,
			};
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
						.values(buildConversationSeedInsertValues(input.conversationSeed))
						.onConflictDoNothing({ target: conversations.id });
				}

				const lockedConversations = await tx
					.select({
						activeBranchId: conversations.activeBranchId,
						activeMessageId: conversations.activeMessageId,
						activeRunId: conversations.activeRunId,
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
					lockedConversation.activeRunId !== input.conversationBaseline.activeRunId ||
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
					const memoryEnabled = isProfileMemoryRuntimeEnabled({ lifecycleState, syncStatus });
					memorySnapshot = {
						appendEnabled: memoryEnabled,
						ownerGeneration: settings?.generation ?? 1,
						ownerSequence: settings?.commandSequence ?? 0,
						recallEnabled: memoryEnabled,
					};
				}
				const frozenAdmission = input.freezeDurableAdmission(memorySnapshot);

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
						buildAcceptTurnDispatchInsertValues(
							input.turnDispatch,
							memorySnapshot,
							frozenAdmission,
						),
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
				return { frozenAdmission, memorySnapshot };
			});
		},

		async finalizeRequest(input) {
			const db = await getDb();
			let activeStateAdvanced = false;
			let replayed = false;
			await db.transaction(async (tx) => {
				const existingRows = await tx
					.select({
						admissionStatus: turnDispatches.admissionStatus,
						completedAt: turnDispatches.completedAt,
						finalizationFingerprint: turnDispatches.finalizationFingerprint,
						status: turnDispatches.status,
						workflowId: turnDispatches.workflowId,
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
				const finalizedAdmissionStatus = input.admissionFailure
					? "admission_failed"
					: existing?.admissionStatus === "cancelled"
						? "cancelled"
						: input.durableAdmissionConfirmed ||
								existing?.admissionStatus === "dispatching" ||
								existing?.admissionStatus === "admitted"
							? "admitted"
							: "admission_failed";
				const finalizedDispatchRows = await tx
					.update(turnDispatches)
					.set({
						...buildFinalizeTurnDispatchUpdateValues(input.turnDispatch),
						admissionStatus: finalizedAdmissionStatus,
						...(input.admissionFailure
							? {
									workflowId: sql<string>`coalesce(
										${turnDispatches.workflowId},
										${input.admissionFailure.workflowId}
										)`,
								}
							: {}),
						admissionInputJson: null,
						admissionInputSha256: null,
						cancelOutboxStatus: sql<string>`case
							when ${turnDispatches.cancelOutboxStatus} = 'not_requested'
								then 'not_requested'
							else 'closed'
						end`,
						finalizationFingerprint: input.finalizationFingerprint ?? null,
					})
					.where(
						and(
							eq(turnDispatches.requestId, input.turnDispatch.requestId),
							eq(turnDispatches.status, "accepted"),
							...(input.admissionFailure
								? [
										and(
											eq(turnDispatches.admissionStatus, "dispatching"),
											eq(turnDispatches.workflowId, input.admissionFailure.workflowId),
										),
									]
								: []),
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

		async recordStreamAppApiTtft(input) {
			const db = await getDb();
			const timing = requestObservabilityFact.stageTimingJson;
			const timingWithTtft = sql<Record<string, unknown>>`jsonb_set(
				${timing},
				array['stream.app_api_ttft_ms'],
				to_jsonb(${input.durationMs}::double precision),
				true
			)`;
			const updated = await db
				.update(requestObservabilityFact)
				.set({
					stageTimingJson: withStreamOrchestrationOverhead(timingWithTtft),
					updatedAt: sql<Date>`greatest(
						${requestObservabilityFact.updatedAt},
						${new Date(input.observedAt)}
					)`,
				})
				.where(
					and(
						eq(requestObservabilityFact.requestId, input.requestId),
						sql`not (${requestObservabilityFact.stageTimingJson} ? 'stream.app_api_ttft_ms')`,
					),
				)
				.returning({ requestId: requestObservabilityFact.requestId });
			return updated.length === 1;
		},

		async readRequestStageTiming(requestId) {
			const db = await getDb();
			const rows = await db
				.select({ stageTiming: requestObservabilityFact.stageTimingJson })
				.from(requestObservabilityFact)
				.where(eq(requestObservabilityFact.requestId, requestId))
				.limit(1);
			if (!rows[0]) {
				throw new Error(`Request observability fact ${requestId} was not found.`);
			}
			return rows[0].stageTiming;
		},
	};
}
