import { Buffer } from "node:buffer";
import {
	ChatFeedbackCursorSchema,
	ChatFeedbackDetailSchema,
	ChatFeedbackPageSchema,
	type ChatFeedbackQuery,
} from "campus-contracts/chat-feedback";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { RuntimeDbGetter } from "../../db/runtime";
import { conversations, messageFeedback, messages } from "../../db/schema";
import { AppApiRouteError } from "../../http";

import { normalizeChatStructuredParts } from "./model";

const answer = alias(messages, "feedback_answer");
const question = alias(messages, "feedback_question");
const visibleConversation = and(
	eq(conversations.id, messageFeedback.conversationId),
	eq(conversations.ownerUserId, messageFeedback.ownerUserId),
	isNull(conversations.deletedAt),
);
const feedbackAnswer = and(
	eq(answer.id, messageFeedback.messageId),
	eq(answer.conversationId, messageFeedback.conversationId),
	eq(answer.role, "assistant"),
);
const feedbackQuestion = and(
	eq(question.id, answer.parentMessageId),
	eq(question.conversationId, answer.conversationId),
	eq(question.role, "user"),
);
const fields = {
	feedbackId: messageFeedback.feedbackId,
	conversationId: messageFeedback.conversationId,
	messageId: messageFeedback.messageId,
	requestId: messageFeedback.requestId,
	vote: messageFeedback.vote,
	reasonCodes: messageFeedback.reasonCodesJson,
	updatedAt: messageFeedback.updatedAt,
};

function decodeCursor(value: string | undefined) {
	if (!value) {
		return null;
	}
	try {
		return ChatFeedbackCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString()));
	} catch {
		throw new AppApiRouteError({
			code: "invalid_feedback_cursor",
			message: "反馈分页游标无效。",
			status: 400,
			retryable: false,
		});
	}
}

export function createChatFeedbackQueryService({ getDb }: { getDb: RuntimeDbGetter }) {
	return {
		async list(query: ChatFeedbackQuery) {
			const cursor = decodeCursor(query.cursor);
			const filter = and(
				query.requestId ? eq(messageFeedback.requestId, query.requestId) : undefined,
				query.from ? gte(messageFeedback.updatedAt, new Date(query.from)) : undefined,
				query.to ? lt(messageFeedback.updatedAt, new Date(query.to)) : undefined,
			);
			const db = await getDb();
			return db.transaction(
				async (tx) => {
					const rows = await tx
						.select({
							...fields,
							questionPreview: sql<string | null>`left(${question.text}, 160)`,
							answerPreview: sql<string>`left(${answer.text}, 160)`,
						})
						.from(messageFeedback)
						.innerJoin(conversations, visibleConversation)
						.innerJoin(answer, feedbackAnswer)
						.leftJoin(question, feedbackQuestion)
						.where(
							and(
								filter,
								query.vote ? eq(messageFeedback.vote, query.vote) : undefined,
								cursor
									? or(
											lt(messageFeedback.updatedAt, new Date(cursor.at)),
											and(
												eq(messageFeedback.updatedAt, new Date(cursor.at)),
												lt(messageFeedback.feedbackId, cursor.id),
											),
										)
									: undefined,
							),
						)
						.orderBy(desc(messageFeedback.updatedAt), desc(messageFeedback.feedbackId))
						.limit(query.limit + 1);
					const [counts] = await tx
						.select({
							total: sql<number>`count(*)::int`,
							helpful: sql<number>`count(*) filter (where ${messageFeedback.vote} = 'helpful')::int`,
							unhelpful: sql<number>`count(*) filter (where ${messageFeedback.vote} = 'unhelpful')::int`,
						})
						.from(messageFeedback)
						.innerJoin(conversations, visibleConversation)
						.innerJoin(answer, feedbackAnswer)
						.where(filter);
					const items = rows
						.slice(0, query.limit)
						.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
					const last = items.at(-1);
					return ChatFeedbackPageSchema.parse({
						items,
						counts,
						nextCursor:
							rows.length > query.limit && last
								? Buffer.from(JSON.stringify({ at: last.updatedAt, id: last.feedbackId })).toString(
										"base64url",
									)
								: null,
					});
				},
				{ isolationLevel: "repeatable read", accessMode: "read only" },
			);
		},
		async getDetail(feedbackId: string) {
			const db = await getDb();
			const [row] = await db
				.select({
					...fields,
					answerText: answer.text,
					answerParts: answer.structuredPartsJson,
					questionId: question.id,
					questionText: question.text,
				})
				.from(messageFeedback)
				.innerJoin(conversations, visibleConversation)
				.innerJoin(answer, feedbackAnswer)
				.leftJoin(question, feedbackQuestion)
				.where(eq(messageFeedback.feedbackId, feedbackId))
				.limit(1);
			if (!row) {
				return null;
			}
			const { answerText, answerParts, questionId, questionText, ...feedback } = row;
			return ChatFeedbackDetailSchema.parse({
				...feedback,
				updatedAt: feedback.updatedAt.toISOString(),
				answer: {
					messageId: feedback.messageId,
					text: answerText,
					sources: normalizeChatStructuredParts(answerParts).flatMap((part) =>
						part.type === "source_items" ? part.sourceItems : [],
					),
				},
				question:
					questionId !== null && questionText !== null
						? { messageId: questionId, text: questionText }
						: null,
			});
		},
	};
}

export type ChatFeedbackQueryService = ReturnType<typeof createChatFeedbackQueryService>;
