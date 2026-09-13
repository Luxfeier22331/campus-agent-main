import { z } from "zod";
import { ChatSourceItemSchema } from "./chat-sources.ts";

export const ChatFeedbackVoteSchema = z.enum(["helpful", "unhelpful"]);
export const ChatFeedbackReasonSchema = z.enum([
	"wrong_intent",
	"not_enough_detail",
	"outdated_or_missing_source",
	"incorrect_answer",
	"unclear_or_hard_to_use",
	"other",
]);
export const ChatFeedbackIdentifierSchema = z.string().trim().min(1).max(200);
const timestamp = z.iso.datetime({ offset: true });

export const ChatFeedbackQuerySchema = z
	.object({
		vote: ChatFeedbackVoteSchema.optional(),
		from: timestamp.optional(),
		to: timestamp.optional(),
		requestId: ChatFeedbackIdentifierSchema.optional(),
		cursor: z.string().min(1).max(1024).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
	})
	.strict()
	.refine((value) => !(value.from && value.to) || Date.parse(value.from) < Date.parse(value.to), {
		message: "结束时间必须晚于开始时间。",
		path: ["to"],
	});

export const ChatFeedbackCursorSchema = z
	.object({
		at: timestamp,
		id: ChatFeedbackIdentifierSchema,
	})
	.strict();

const feedbackFields = {
	feedbackId: z.string(),
	conversationId: z.string(),
	messageId: z.string(),
	requestId: z.string(),
	vote: ChatFeedbackVoteSchema,
	reasonCodes: z.array(ChatFeedbackReasonSchema),
	updatedAt: timestamp,
};

export const ChatFeedbackSummarySchema = z
	.object({
		...feedbackFields,
		questionPreview: z.string().nullable(),
		answerPreview: z.string(),
	})
	.strict();

export const ChatFeedbackDetailSchema = z
	.object({
		...feedbackFields,
		question: z.object({ messageId: z.string(), text: z.string() }).strict().nullable(),
		answer: z
			.object({ messageId: z.string(), text: z.string(), sources: z.array(ChatSourceItemSchema) })
			.strict(),
	})
	.strict();

export const ChatFeedbackPageSchema = z
	.object({
		items: z.array(ChatFeedbackSummarySchema),
		nextCursor: z.string().nullable(),
		counts: z
			.object({
				total: z.number().int().nonnegative(),
				helpful: z.number().int().nonnegative(),
				unhelpful: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict();

export type ChatFeedbackQuery = z.infer<typeof ChatFeedbackQuerySchema>;
export type ChatFeedbackPage = z.infer<typeof ChatFeedbackPageSchema>;
export type ChatFeedbackSummary = z.infer<typeof ChatFeedbackSummarySchema>;
export type ChatFeedbackDetail = z.infer<typeof ChatFeedbackDetailSchema>;
export type ChatFeedbackVote = z.infer<typeof ChatFeedbackVoteSchema>;
