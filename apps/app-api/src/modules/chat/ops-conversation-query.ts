import type { OpsConversationListQuery } from "campus-contracts/chat-conversations";
import { OpsChatConversationSchema } from "campus-contracts/chat-conversations";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { RuntimeDbGetter } from "../../db/runtime";
import { conversations, messageFeedback, messages, turnDispatches } from "../../db/schema";
import { normalizeChatStructuredParts } from "./model";

export function createOpsConversationQueryService({ getDb }: { getDb: RuntimeDbGetter }) {
	return {
		async listSummaries(query: OpsConversationListQuery) {
			const db = await getDb();
			const pattern = query.q ? `%${query.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null;
			const cursorRow = query.cursor
				? (
						await db
							.select({ updatedAt: conversations.updatedAt, id: conversations.id })
							.from(conversations)
							.where(eq(conversations.id, query.cursor))
							.limit(1)
					)[0]
				: undefined;
			// Keep accepted/finalizing requests aligned with Ops runtime diagnostics.
			const latestStatus = sql<string>`coalesce((
				select case
					when d.status in ('error', 'rejected') then 'FAILED'
					when d.status = 'approval_required' then 'ACTION_REQUIRED'
					when d.status = 'cancelled' then 'CANCELLED'
					when d.status = 'accepted' then case
						when r.status in ('running', 'streaming', 'completed', 'failed', 'expired', 'canceled') then 'RUNNING'
						else 'PENDING'
					end
					else 'COMPLETED'
				end
				from chat.turn_dispatches d
				left join execution_control.agent_runs r on r.request_id = d.request_id
				where d.conversation_id = ${conversations.id}
				order by d.created_at desc, d.request_id desc limit 1
			), 'COMPLETED')`;
			const rows = await db
				.select({
					id: conversations.id,
					title: conversations.title,
					ownerId: conversations.ownerUserId,
					createdAt: conversations.createdAt,
					updatedAt: conversations.updatedAt,
					messageCount: sql<number>`(select count(*)::int from chat.messages m where m.conversation_id = ${conversations.id})`,
					turnCount: sql<number>`(select count(*)::int from chat.turn_dispatches d where d.conversation_id = ${conversations.id})`,
					latestQuestion: sql<
						string | null
					>`coalesce((select m.text from chat.messages m where m.conversation_id = ${conversations.id} and m.role = 'user' order by m.created_at desc, m.id desc limit 1), ${conversations.title})`,
					latestAnswer: sql<
						string | null
					>`(select m.text from chat.messages m where m.conversation_id = ${conversations.id} and m.role = 'assistant' order by m.created_at desc, m.id desc limit 1)`,
					latestRequestId: sql<
						string | null
					>`(select d.request_id from chat.turn_dispatches d where d.conversation_id = ${conversations.id} order by d.created_at desc, d.request_id desc limit 1)`,
					latestStatus,
					hasFailures: sql<boolean>`exists (select 1 from chat.turn_dispatches d where d.conversation_id = ${conversations.id} and d.status in ('error','rejected'))`,
					hasFeedback: sql<boolean>`exists (select 1 from chat.message_feedback f where f.conversation_id = ${conversations.id})`,
				})
				.from(conversations)
				.where(
					and(
						isNull(conversations.deletedAt),
						query.ownerId ? eq(conversations.ownerUserId, query.ownerId) : undefined,
						query.from ? sql`${conversations.updatedAt} >= ${new Date(query.from)}` : undefined,
						query.to ? sql`${conversations.updatedAt} <= ${new Date(query.to)}` : undefined,
						cursorRow
							? sql`(${conversations.updatedAt}, ${conversations.id}) < (${cursorRow.updatedAt}, ${cursorRow.id})`
							: undefined,
						query.status ? sql`${latestStatus} = ${query.status}` : undefined,
						query.feedback === "WITH_FEEDBACK"
							? sql`exists (select 1 from chat.message_feedback f where f.conversation_id = ${conversations.id})`
							: query.feedback === "WITHOUT_FEEDBACK"
								? sql`not exists (select 1 from chat.message_feedback f where f.conversation_id = ${conversations.id})`
								: undefined,
						pattern
							? sql`(${conversations.title} ilike ${pattern} escape '\\' or exists (select 1 from chat.messages m where m.conversation_id = ${conversations.id} and m.text ilike ${pattern} escape '\\') or ${conversations.id} ilike ${pattern} escape '\\' or exists (select 1 from chat.turn_dispatches d where d.conversation_id = ${conversations.id} and d.request_id ilike ${pattern} escape '\\'))`
							: undefined,
						query.hasFailures === undefined
							? undefined
							: query.hasFailures
								? sql`exists (select 1 from chat.turn_dispatches d where d.conversation_id = ${conversations.id} and d.status in ('error','rejected'))`
								: sql`not exists (select 1 from chat.turn_dispatches d where d.conversation_id = ${conversations.id} and d.status in ('error','rejected'))`,
					),
				)
				.orderBy(desc(conversations.updatedAt), desc(conversations.id))
				.limit(query.limit + 1);
			const page = rows.slice(0, query.limit);
			return {
				rows: page.map((row) => ({ ...row, displayName: null })),
				nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
			};
		},
		async getDetail(conversationId: string) {
			const db = await getDb();
			return db.transaction(
				async (tx) => {
					const [conversation] = await tx
						.select({
							id: conversations.id,
							title: conversations.title,
							createdAt: conversations.createdAt,
							updatedAt: conversations.updatedAt,
							activeRequestId: conversations.activeRequestId,
						})
						.from(conversations)
						.where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
						.limit(1);
					if (!conversation) {
						return null;
					}
					const rows = await tx
						.select({
							id: messages.id,
							role: messages.role,
							kind: messages.kind,
							text: messages.text,
							createdAt: messages.createdAt,
							parentMessageId: messages.parentMessageId,
							requestId: sql<
								string | null
							>`coalesce(${messages.requestId}, ${turnDispatches.requestId})`,
							parts: messages.structuredPartsJson,
							feedbackId: messageFeedback.feedbackId,
							vote: messageFeedback.vote,
							reasonCodes: messageFeedback.reasonCodesJson,
							feedbackUpdatedAt: messageFeedback.updatedAt,
						})
						.from(messages)
						.innerJoin(
							conversations,
							and(eq(conversations.id, messages.conversationId), isNull(conversations.deletedAt)),
						)
						.leftJoin(
							turnDispatches,
							and(
								eq(turnDispatches.conversationId, messages.conversationId),
								eq(turnDispatches.userMessageId, messages.id),
								eq(messages.role, "user"),
							),
						)
						.leftJoin(
							messageFeedback,
							and(
								eq(messageFeedback.messageId, messages.id),
								eq(messageFeedback.conversationId, messages.conversationId),
								eq(messageFeedback.ownerUserId, conversations.ownerUserId),
								eq(messages.role, "assistant"),
							),
						)
						.where(eq(messages.conversationId, conversationId))
						.orderBy(
							asc(messages.createdAt),
							asc(messages.turnSequence),
							sql`case when ${messages.role} = 'user' then 0 else 1 end`,
							asc(messages.id),
						);
					return OpsChatConversationSchema.parse({
						...conversation,
						createdAt: conversation.createdAt.toISOString(),
						updatedAt: conversation.updatedAt.toISOString(),
						messages: rows.map(
							({ parts, feedbackId, vote, reasonCodes, feedbackUpdatedAt, ...message }) => ({
								...message,
								createdAt: message.createdAt.toISOString(),
								sources: normalizeChatStructuredParts(parts).flatMap((part) =>
									part.type === "source_items" ? part.sourceItems : [],
								),
								feedback: feedbackId
									? { feedbackId, vote, reasonCodes, updatedAt: feedbackUpdatedAt?.toISOString() }
									: null,
							}),
						),
					});
				},
				{ isolationLevel: "repeatable read", accessMode: "read only" },
			);
		},
	};
}
export type OpsConversationQueryService = ReturnType<typeof createOpsConversationQueryService>;
