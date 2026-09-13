// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { ChatFeedbackQuery } from "campus-contracts/chat-feedback";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { appApiSchema, conversations, messageFeedback, messages } from "../src/db/schema";
import { createChatFeedbackQueryService } from "../src/modules/chat/feedback-query";
import { createOpsConversationQueryService } from "../src/modules/chat/ops-conversation-query";
import { createPgChatConversationFeedbackStore } from "../src/modules/chat/store-feedback-operations";

const postgres = inject("appApiPostgres");
const at = new Date("2040-09-13T08:00:00Z");
const window = { from: "2040-09-13T00:00:00Z", to: "2040-09-14T00:00:00Z", limit: 50 };

describe("chat feedback PostgreSQL queries", () => {
	let pool: Pool;
	let db: ReturnType<typeof drizzle<typeof appApiSchema>>;
	let service: ReturnType<typeof createChatFeedbackQueryService>;
	let writer: ReturnType<typeof createPgChatConversationFeedbackStore>;
	let conversationId: string;
	const id = (suffix: string) => `${conversationId}-${suffix}`;
	const list = (query: Partial<ChatFeedbackQuery> = {}) => service.list({ ...window, ...query });
	beforeAll(() => {
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 2, ssl: false });
		db = drizzle(pool, { schema: appApiSchema });
		service = createChatFeedbackQueryService({ getDb: async () => db });
		writer = createPgChatConversationFeedbackStore({ getDb: async () => db });
	});
	beforeEach(async () => {
		conversationId = `feedback-${randomUUID()}`;
		await db.insert(conversations).values({
			id: conversationId,
			ownerUserId: id("owner"),
			title: "Feedback query fixture",
			createdAt: at,
			updatedAt: at,
		});
		for (const n of [1, 2, 3]) {
			await db.insert(messages).values([
				{
					id: id(`q${n}`),
					conversationId,
					role: "user",
					text: `第${n}轮问题`,
					createdAt: at,
					turnSequence: n,
				},
				{
					id: id(`a${n}`),
					conversationId,
					role: "assistant",
					kind: "answer",
					turnSequence: n,
					text: `第${n}轮回答`,
					parentMessageId: id(`q${n}`),
					requestId: id(`r${n}`),
					createdAt: at,
				},
			]);
			await db.insert(messageFeedback).values({
				feedbackId: id(`f${n}`),
				ownerUserId: id("owner"),
				conversationId,
				messageId: id(`a${n}`),
				requestId: id(`r${n}`),
				vote: n === 1 ? "helpful" : "unhelpful",
				reasonCodesJson: n === 3 ? ["incorrect_answer"] : [],
				createdAt: at,
				updatedAt: at,
			});
		}
	});
	afterEach(async () => {
		await db.delete(conversations).where(eq(conversations.id, conversationId));
	});
	afterAll(async () => {
		await pool.end();
	});

	it("paginates equal timestamps without changing filtered totals", async () => {
		const first = await list({ limit: 2 });
		expect(first.items.map((item) => item.feedbackId)).toEqual([id("f3"), id("f2")]);
		expect(first.counts).toEqual({ total: 3, helpful: 1, unhelpful: 2 });
		const second = await list({ limit: 2, cursor: first.nextCursor ?? undefined });
		expect(second.items.map((item) => item.feedbackId)).toEqual([id("f1")]);
		expect(second.counts).toEqual(first.counts);
		expect(second.nextCursor).toBeNull();
		expect((await list({ vote: "unhelpful" })).counts).toEqual({
			total: 2,
			helpful: 0,
			unhelpful: 2,
		});
		expect((await list({ requestId: id("r1") })).items).toHaveLength(1);
		expect((await list({ requestId: id("r") })).items).toHaveLength(0);
	});
	it("includes the start time, excludes the end time, and rejects malformed cursors", async () => {
		expect((await list({ from: at.toISOString() })).counts.total).toBe(3);
		expect((await list({ to: at.toISOString() })).counts.total).toBe(0);
		await expect(list({ cursor: "invalid" })).rejects.toMatchObject({ status: 400 });
	});
	it("reads the evaluated turn, existing reasons and unavailable questions", async () => {
		expect(await service.getDetail(id("f1"))).toMatchObject({
			question: { messageId: id("q1"), text: "第1轮问题" },
			answer: { text: "第1轮回答" },
			reasonCodes: [],
		});
		expect(await service.getDetail(id("f3"))).toMatchObject({
			question: { text: "第3轮问题" },
			reasonCodes: ["incorrect_answer"],
		});
		await db
			.update(messages)
			.set({ parentMessageId: null })
			.where(eq(messages.id, id("a1")));
		expect(await service.getDetail(id("f1"))).toMatchObject({ question: null });
		expect((await list()).counts.total).toBe(3);
	});
	it("reflects actual feedback writes, withdrawal and conversation deletion", async () => {
		const target = { ownerUserId: id("owner"), conversationId, messageId: id("a1") };
		await writer.upsertMessageFeedbackByOwner({
			...target,
			feedbackId: id("new"),
			vote: "unhelpful",
			reasonCodes: ["wrong_intent"],
			updatedAt: "2040-09-13T09:00:00Z",
		});
		const page = await list();
		expect(page.counts).toEqual({ total: 3, helpful: 0, unhelpful: 3 });
		expect(page.items[0]).toMatchObject({
			feedbackId: id("f1"),
			updatedAt: "2040-09-13T09:00:00.000Z",
			reasonCodes: ["wrong_intent"],
		});
		await writer.deleteMessageFeedbackByOwner(target);
		expect((await list()).counts.total).toBe(2);
		expect(await service.getDetail(id("f1"))).toBeNull();
		await db
			.update(conversations)
			.set({ deletedAt: at })
			.where(eq(conversations.id, conversationId));
		expect((await list()).counts).toEqual({ total: 0, helpful: 0, unhelpful: 0 });
		expect(await service.getDetail(id("f2"))).toBeNull();
		const rows = await db
			.select()
			.from(messageFeedback)
			.where(eq(messageFeedback.conversationId, conversationId));
		expect(rows).toHaveLength(2);
	});
	it("reads all saved turns, sources and current feedback in stable order", async () => {
		const query = createOpsConversationQueryService({ getDb: async () => db });
		const source = {
			kind: "web_page",
			citationIndexes: [1],
			hostname: "example.org",
			title: "测试来源",
			snippet: null,
			primaryAction: {
				href: "https://example.org/page",
				label: "打开网页",
				external: true,
				disabledReason: null,
			},
		};
		await db
			.update(messages)
			.set({ structuredPartsJson: [{ type: "source_items", sourceItems: [source] }] })
			.where(eq(messages.id, id("a1")));
		const detail = await query.getDetail(conversationId);
		expect(detail?.messages.map((message) => message.id)).toEqual([
			id("q1"),
			id("a1"),
			id("q2"),
			id("a2"),
			id("q3"),
			id("a3"),
		]);
		expect(detail?.messages[1]).toMatchObject({
			parentMessageId: id("q1"),
			requestId: id("r1"),
			sources: [source],
			feedback: { vote: "helpful" },
		});
		expect(detail).not.toHaveProperty("ownerUserId");
		expect((await service.getDetail(id("f1")))?.answer.sources).toEqual([source]);
		await db
			.update(conversations)
			.set({ archivedAt: at })
			.where(eq(conversations.id, conversationId));
		expect(await query.getDetail(conversationId)).not.toBeNull();
		await db.delete(messages).where(eq(messages.id, id("a3")));
		expect((await query.getDetail(conversationId))?.messages).toHaveLength(5);
		await db
			.update(conversations)
			.set({ deletedAt: at })
			.where(eq(conversations.id, conversationId));
		expect(await query.getDetail(conversationId)).toBeNull();
	});
	it("does not attach another conversation's feedback and retains a missing parent identifier", async () => {
		const query = createOpsConversationQueryService({ getDb: async () => db });
		await db
			.update(messageFeedback)
			.set({ ownerUserId: "another-owner" })
			.where(eq(messageFeedback.feedbackId, id("f1")));
		await db
			.update(messages)
			.set({ parentMessageId: "missing-parent" })
			.where(eq(messages.id, id("a1")));
		const answer = (await query.getDetail(conversationId))?.messages.find(
			(message) => message.id === id("a1"),
		);
		expect(answer).toMatchObject({ parentMessageId: "missing-parent", feedback: null });
		expect(await query.getDetail("missing-conversation")).toBeNull();
	});
});
