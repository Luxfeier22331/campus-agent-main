// @vitest-environment node
import { randomUUID } from "node:crypto";
import { OpsConversationListQuerySchema } from "campus-contracts/chat-conversations";
import type { ChatFeedbackQuery } from "campus-contracts/chat-feedback";
import { resolveTimeQuery } from "campus-contracts/ops-time";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { RuntimeDatabase } from "../src/db/runtime";
import { conversations, messageFeedback, messages } from "../src/db/schema";
import { createChatFeedbackQueryService } from "../src/modules/chat/feedback-query";
import { createOpsConversationQueryService } from "../src/modules/chat/ops-conversation-query";
import { createPgChatConversationFeedbackStore } from "../src/modules/chat/store-feedback-operations";

const postgres = inject("appApiPostgres");
const at = new Date("2040-09-13T08:00:00Z");
const window = { from: "2040-09-13T00:00:00Z", to: "2040-09-14T00:00:00Z", limit: 50 };

describe("chat feedback PostgreSQL queries", () => {
	let pool: Pool;
	let db: RuntimeDatabase;
	let service: ReturnType<typeof createChatFeedbackQueryService>;
	let writer: ReturnType<typeof createPgChatConversationFeedbackStore>;
	let conversationId: string;
	const id = (suffix: string) => `${conversationId}-${suffix}`;
	const list = (query: Partial<ChatFeedbackQuery> = {}) => service.list({ ...window, ...query });
	beforeAll(() => {
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 2, ssl: false });
		db = drizzle({ client: pool });
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
		expect(
			(await list({ vote: "unhelpful" })).items.every((item) => item.vote === "unhelpful"),
		).toBe(true);
		expect((await list({ vote: "unhelpful" })).counts).toEqual({
			total: 3,
			helpful: 1,
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

describe("conversation summaries PostgreSQL queries", () => {
	let runtime: Pool;
	let management: Pool;
	let service: ReturnType<typeof createOpsConversationQueryService>;
	let owner: string;
	beforeAll(() => {
		runtime = new Pool({ connectionString: postgres.runtimeConnectionString, max: 2 });
		management = new Pool({ connectionString: postgres.managementConnectionString, max: 1 });
		const db = drizzle({ client: runtime });
		service = createOpsConversationQueryService({
			getDb: async () => db,
			now: () => new Date(at.valueOf() + 3_600_000),
		});
	});
	beforeEach(() => {
		owner = `summary-${randomUUID()}`;
	});
	afterEach(async () => {
		await management.query("delete from agent_control.agent_runs where owner_user_id = $1", [
			owner,
		]);
		await runtime.query("delete from chat.conversations where owner_user_id = $1", [owner]);
	});
	afterAll(async () => {
		await management.end();
		await runtime.end();
	});
	async function conversation(suffix: string) {
		const id = `${owner}-${suffix}`;
		await runtime.query(
			"insert into chat.conversations (id, owner_user_id, title, created_at, updated_at) values ($1, $2, 'Summary fixture', $3, $3)",
			[id, owner, at],
		);
		return id;
	}
	async function dispatch(id: string, status: string, runStatus: string | null, turn = 1) {
		const requestId = `${id}-r${turn}`;
		const createdAt = new Date(at.valueOf() + turn * 1000);
		await runtime.query(
			"insert into chat.messages (id, conversation_id, role, text, created_at, turn_sequence) values ($1, $2, 'user', 'Question', $3, $4)",
			[`${id}-q${turn}`, id, createdAt, turn],
		);
		await runtime.query(
			`insert into chat.turn_dispatches
			(request_id, conversation_id, user_message_id, assistant_message_id, turn_sequence, surface, owner_user_id, actor_user_id, principal_snapshot_json, status, created_at, updated_at, execution_input_json, execution_input_sha256)
			values ($1, $2, $3, $4, $5, 'campus_web', $6, $6, '{}', $7, $8, $8, '{}', $9)`,
			[
				requestId,
				id,
				`${id}-q${turn}`,
				`${id}-a${turn}`,
				turn,
				owner,
				status,
				createdAt,
				"a".repeat(64),
			],
		);
		if (runStatus !== null) {
			await management.query(
				`insert into agent_control.agent_runs
				(request_id, conversation_id, owner_user_id, surface, task_queue, status, created_at, updated_at)
				values ($1, $2, $3, 'campus_web', 'test', $4, $5, $5)`,
				[requestId, id, owner, runStatus, createdAt],
			);
		}
	}
	const list = (query: Record<string, unknown> = {}) =>
		service.listSummaries(OpsConversationListQuerySchema.parse({ ownerId: owner, ...query }));

	it("searches owner names and emails before pagination and combines with content", async () => {
		const name = `验收_${owner}%\\`;
		const email = `${owner}@example.test`;
		const otherOwner = `${owner}-other`;
		await management.query(
			'insert into app_auth."user" (id, name, email, "createdAt", "updatedAt") values ($1, $2, $3, $4, $4)',
			[owner, name, email, at],
		);
		try {
			const first = await conversation("a");
			const second = await conversation("b");
			await runtime.query(
				"insert into chat.conversations (id, owner_user_id, title, created_at, updated_at) values ($1, $2, $3, $4, $4)",
				[otherOwner, otherOwner, name, at],
			);
			for (const ownerQuery of [name, email.toUpperCase(), owner]) {
				const query = { ownerId: undefined, ownerQuery, limit: 1 };
				const page = await list(query);
				expect(page.rows.map((row) => row.id)).toEqual([second]);
				expect(page.nextCursor).toBe(second);
				const next = await list({ ...query, cursor: page.nextCursor });
				expect(next.rows.map((row) => row.id)).toEqual([first]);
				expect(next.nextCursor).toBeNull();
			}
			await runtime.query("update chat.conversations set title = '办理材料' where id = $1", [
				first,
			]);
			expect(
				(await list({ ownerId: undefined, ownerQuery: name, q: "办理" })).rows.map((row) => row.id),
			).toEqual([first]);
			expect((await list({ ownerId: undefined, ownerQuery: `missing-${owner}` })).rows).toEqual([]);
			// Missing account data still supports a full user ID, but not an ID prefix.
			expect(
				(await list({ ownerId: undefined, ownerQuery: otherOwner })).rows.map((row) => row.id),
			).toEqual([otherOwner]);
			expect(
				(await list({ ownerId: undefined, ownerQuery: otherOwner.slice(0, -1) })).rows,
			).toEqual([]);
		} finally {
			await runtime.query("delete from chat.conversations where owner_user_id = $1", [otherOwner]);
			await management.query('delete from app_auth."user" where id = $1', [owner]);
		}
	});

	it.each([
		["accepted", null, "PENDING"],
		["accepted", "created", "PENDING"],
		["accepted", "queued", "PENDING"],
		["accepted", "admitted", "PENDING"],
		["accepted", "running", "RUNNING"],
		["accepted", "streaming", "RUNNING"],
		["accepted", "completed", "RUNNING"],
		["accepted", "failed", "RUNNING"],
		["accepted", "expired", "RUNNING"],
		["accepted", "canceled", "RUNNING"],
		["completed", "running", "COMPLETED"],
		["error", "running", "FAILED"],
		["rejected", "completed", "FAILED"],
		["approval_required", "running", "ACTION_REQUIRED"],
		["cancelled", "running", "CANCELLED"],
	] as const)(
		"projects %s / %s as %s using the runtime role",
		async (status, runStatus, expected) => {
			const id = await conversation("one");
			await dispatch(id, status, runStatus);
			expect((await list()).rows).toMatchObject([{ id, latestStatus: expected }]);
			expect((await list({ status: expected })).rows).toHaveLength(1);
			expect(
				(await list({ status: expected === "RUNNING" ? "PENDING" : "RUNNING" })).rows,
			).toHaveLength(0);
		},
	);

	it("pairs previews with the latest dispatch, including an unanswered latest question", async () => {
		const id = await conversation("pairing");
		await dispatch(id, "completed", null);
		await runtime.query(
			"insert into chat.messages (id, conversation_id, role, text, request_id, parent_message_id, created_at, turn_sequence) values ($1, $2, 'assistant', 'First answer', $3, $4, $5, 1)",
			[`${id}-a1`, id, `${id}-r1`, `${id}-q1`, at],
		);
		expect((await list()).rows).toMatchObject([{ latestAnswer: "First answer" }]);
		await dispatch(id, "accepted", null, 2);
		await runtime.query("update chat.messages set text = 'Second question' where id = $1", [
			`${id}-q2`,
		]);
		expect((await list()).rows).toMatchObject([
			{
				latestQuestion: "Second question",
				latestAnswer: null,
				latestRequestId: `${id}-r2`,
				latestStatus: "PENDING",
			},
		]);
	});

	it("can read only the two granted execution columns", async () => {
		await expect(
			runtime.query("select request_id, status from agent_control.agent_runs limit 0"),
		).resolves.toMatchObject({ rowCount: 0 });
		for (const statement of [
			"select * from agent_control.agent_runs limit 0",
			"select metadata_json from agent_control.agent_runs limit 0",
			"select request_id from agent_control.agent_run_events limit 0",
			"update agent_control.agent_runs set status = status where false",
			"delete from agent_control.agent_runs where false",
		]) {
			await expect(runtime.query(statement)).rejects.toMatchObject({ code: "42501" });
		}
	});

	it("filters the latest dispatch and failure history before paginating", async () => {
		const first = await conversation("a");
		const withFailure = await conversation("b");
		const second = await conversation("c");
		const pending = await conversation("d");
		await dispatch(first, "accepted", "running");
		await dispatch(withFailure, "error", "failed");
		await dispatch(withFailure, "accepted", "streaming", 2);
		await dispatch(second, "accepted", "completed");
		await dispatch(pending, "accepted", "queued");
		const query = { status: "RUNNING", hasFailures: "false", limit: 1 };
		const page = await list(query);
		expect(page.rows).toMatchObject([{ id: second, hasFailures: false, latestStatus: "RUNNING" }]);
		expect(page.nextCursor).toBe(second);
		const next = await list({ ...query, cursor: page.nextCursor });
		expect(next.rows).toMatchObject([{ id: first, latestStatus: "RUNNING" }]);
		expect(next.nextCursor).toBeNull();
		expect((await list({ status: "RUNNING", hasFailures: "true" })).rows).toMatchObject([
			{ id: withFailure, latestRequestId: `${withFailure}-r2`, hasFailures: true },
		]);
	});

	it("uses a half-open interval for empty conversations", async () => {
		const id = await conversation("empty");
		expect(
			(await list({ from: at.toISOString(), to: new Date(at.valueOf() + 1).toISOString() })).rows,
		).toMatchObject([{ id, latestStatus: "COMPLETED" }]);
		expect(
			(await list({ from: new Date(at.valueOf() - 1).toISOString(), to: at.toISOString() })).rows,
		).toHaveLength(0);
	});

	it.each(["today", "24h", "this-week", "this-month", "last-month", "30d"] as const)(
		"actually filters the %s preset before pagination",
		async (window) => {
			const fixedNow = new Date(at.valueOf() + 3_600_000);
			const range = resolveTimeQuery({ window }, "conversations", fixedNow);
			const times = [
				Date.parse(range.from) - 1,
				Date.parse(range.from),
				Date.parse(range.to) - 1,
				Date.parse(range.to),
				Date.parse(range.to) + 1,
			];
			const ids: string[] = [];
			for (const [index, time] of times.entries()) {
				const id = await conversation(`boundary-${index}`);
				ids.push(id);
				await runtime.query("update chat.conversations set updated_at = $1 where id = $2", [
					new Date(time),
					id,
				]);
			}
			const result = await list({ window, limit: 1 });
			expect(result.filters).toEqual(range);
			expect(result.rows.map((row) => row.id)).toEqual([ids[2]]);
			const next = await list({ window, limit: 1, cursor: result.nextCursor });
			expect(next.rows.map((row) => row.id)).toEqual([ids[1]]);
			expect(next.nextCursor).toBeNull();
		},
	);
});
