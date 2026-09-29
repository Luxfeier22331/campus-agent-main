import { z } from "zod";
import { ChatFeedbackReasonSchema, ChatFeedbackVoteSchema } from "./chat-feedback.ts";
import { ChatSourceItemSchema } from "./chat-sources.ts";
import { timeQueryShape, validateTimeQuery } from "./ops-time.ts";

export const ChatConversationIdentifierSchema = z.string().trim().min(1).max(200);
const timestamp = z.iso.datetime({ offset: true });
export const OpsChatMessageSchema = z
	.object({
		id: z.string(),
		role: z.enum(["user", "assistant"]),
		kind: z.enum(["answer", "error"]).nullable(),
		text: z.string(),
		createdAt: timestamp,
		parentMessageId: z.string().nullable(),
		requestId: z.string().nullable(),
		sources: z.array(ChatSourceItemSchema),
		feedback: z
			.object({
				feedbackId: z.string(),
				vote: ChatFeedbackVoteSchema,
				reasonCodes: z.array(ChatFeedbackReasonSchema),
				updatedAt: timestamp,
			})
			.strict()
			.nullable(),
	})
	.strict();
export const OpsChatConversationSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		createdAt: timestamp,
		updatedAt: timestamp,
		activeRequestId: z.string().nullable(),
		messages: z.array(OpsChatMessageSchema),
	})
	.strict();

export const OpsConversationListStatusSchema = z.enum([
	"COMPLETED",
	"FAILED",
	"RUNNING",
	"PENDING",
	"ACTION_REQUIRED",
	"CANCELLED",
]);
export const OpsConversationListQuerySchema = z
	.object({
		q: z.string().trim().min(1).max(256).optional(),
		ownerId: z.string().trim().min(1).max(200).optional(),
		status: OpsConversationListStatusSchema.optional(),
		feedback: z.enum(["ANY", "WITH_FEEDBACK", "WITHOUT_FEEDBACK"]).default("ANY"),
		hasFailures: z
			.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
			.optional(),
		...timeQueryShape,
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(30),
	})
	.strict()
	.superRefine(validateTimeQuery("conversations"));
export const OpsConversationSummarySchema = z
	.object({
		id: ChatConversationIdentifierSchema,
		title: z.string(),
		owner: z
			.object({
				id: z.string().min(1),
				displayName: z.string().nullable(),
				email: z.email().nullable(),
			})
			.strict(),
		createdAt: timestamp,
		updatedAt: timestamp,
		messageCount: z.number().int().nonnegative(),
		turnCount: z.number().int().nonnegative(),
		latestQuestionPreview: z.string().nullable(),
		latestAnswerPreview: z.string().nullable(),
		latestRequestId: z.string().nullable(),
		latestStatus: OpsConversationListStatusSchema,
		hasFailures: z.boolean(),
		hasFeedback: z.boolean(),
	})
	.strict();
export const OpsConversationListResponseSchema = z
	.object({
		data: z.array(OpsConversationSummarySchema),
		page: z.object({ nextCursor: z.string().nullable() }).strict(),
		generatedAt: timestamp,
		filters: z.object({ from: timestamp.nullable(), to: timestamp.nullable() }).strict(),
	})
	.strict();
export type OpsConversationListQuery = z.infer<typeof OpsConversationListQuerySchema>;
