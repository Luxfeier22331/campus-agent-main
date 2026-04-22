import { and, asc, desc, eq, gte } from "drizzle-orm";

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
import type { ChatCommandStore } from "./store-types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export type {
	AbuseControlState,
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
			if (!safetyIdentifier || !surface) {
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
					.set(
						buildConversationTitleUpdateValues({
							title: input.conversationTitle,
							updatedAt: input.userMessage.createdAt,
						}),
					)
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
			await db.transaction(async (tx) => {
				await tx.insert(messages).values(buildChatMessageInsertValues(input.assistantMessage));

				await tx
					.update(requestExecution)
					.set(buildFinalizeRequestExecutionUpdateValues(input.requestExecution))
					.where(eq(requestExecution.requestId, input.requestExecution.requestId));

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

				await tx
					.update(conversations)
					.set(
						buildConversationTitleUpdateValues({
							title: input.conversationTitle,
							updatedAt: input.assistantMessage.createdAt,
						}),
					)
					.where(
						and(
							eq(conversations.id, input.assistantMessage.conversationId),
							eq(conversations.ownerUserId, input.ownerUserId),
						),
					);

				await tx
					.delete(sessionSlots)
					.where(eq(sessionSlots.conversationId, input.requestExecution.conversationId));

				if (input.sessionSlots.length > 0) {
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
