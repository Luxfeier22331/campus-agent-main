// @vitest-environment node

import { createHash } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { Env } from "../src/config";
import { createPgChatConversationStore } from "../src/modules/chat";
import type {
	ToolExecutionInput,
	ToolExecutionResponse,
} from "../src/modules/integration/execution-control";
import { createPgProfileMemoryStore } from "../src/modules/profile-memory";
import { buildChatCommandService, createPgChatCommandStore } from "../src/modules/runtime-command";
import { createExecutionRuntimeFromToolClient } from "./chat-command.service.test-support";
import { buildSharedDbIntegrationEnv } from "./shared-db-integration-helpers";

const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const postgres = inject("appApiPostgres");

async function readJson(response: Response) {
	return response.json();
}

function requireClient(client: Client | null): Client {
	if (!client) {
		throw new Error("Expected shared DB integration client to be initialized.");
	}

	return client;
}

function buildCookieHeader(response: Response): string {
	const setCookie = response.headers.get("set-cookie");
	if (!setCookie) {
		throw new Error("Expected auth response to include a session cookie.");
	}

	return setCookie
		.split(",")
		.map((value) => value.split(";", 1)[0])
		.join("; ");
}

function readIntegrationAuthShellOrigin(env: Env): string {
	const origin = env.AUTH_SHELL_ORIGIN?.trim();
	if (!origin) {
		throw new Error("AUTH_SHELL_ORIGIN is required for shared product DB integration.");
	}
	return origin;
}

describe("app-api shared product DB integration", () => {
	let app: ReturnType<typeof createApp>;
	let client: Client | null = null;
	let env: Env;

	beforeAll(async () => {
		env = buildSharedDbIntegrationEnv({
			runtimeConnectionString: postgres.runtimeConnectionString,
		});

		app = createApp(env);
		client = new Client({
			connectionString: postgres.managementConnectionString,
			ssl: false,
		});
		await client.connect();
	});

	afterAll(async () => {
		if (!client) {
			return;
		}
		await client.end();
	});

	it("bootstraps app_auth/chat tables without leaving Better Auth tables in public", async () => {
		const dbClient = requireClient(client);
		const relations = [
			"app_auth.user",
			"app_auth.session",
			"app_auth.account",
			"app_auth.verification",
			"chat.conversations",
			"chat.messages",
			"chat.session_slots",
		];

		for (const relation of relations) {
			const [schemaName, tableName] = relation.split(".", 2);
			const queryResult = await dbClient.query(
				`
          select exists(
            select 1
            from information_schema.tables
            where table_schema = $1 and table_name = $2
          ) as present
        `,
				[schemaName, tableName],
			);
			expect(queryResult.rows[0]?.present).toBe(true);
		}

		for (const relation of [
			"public.user",
			"public.session",
			"public.account",
			"public.verification",
		]) {
			const [schemaName, tableName] = relation.split(".", 2);
			const queryResult = await dbClient.query(
				`
          select exists(
            select 1
            from information_schema.tables
            where table_schema = $1 and table_name = $2
          ) as present
        `,
				[schemaName, tableName],
			);
			expect(queryResult.rows[0]?.present).toBe(false);
		}
	});

	it("creates and reads owned conversations through app-api after Better Auth sign-in", async () => {
		const createdEmail = `integration-${Date.now()}@example.edu`;
		const authShellOrigin = readIntegrationAuthShellOrigin(env);

		const authResponse = await app.fetch(
			new Request("https://app-api.internal/api/auth/sign-up/email", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: authShellOrigin,
					referer: `${authShellOrigin}/login`,
					"x-campus-legal-accepted": "terms-and-privacy",
					"x-captcha-response": TURNSTILE_TEST_TOKEN,
				},
				body: JSON.stringify({
					email: createdEmail,
					name: "Integration Student",
					password: "password12345",
				}),
			}),
		);

		expect(authResponse.ok).toBe(true);
		const cookieHeader = buildCookieHeader(authResponse);

		const createResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations", {
				method: "POST",
				headers: {
					cookie: cookieHeader,
				},
			}),
		);
		const createPayload = (await readJson(createResponse)) as {
			conversation: { id: string };
		};

		expect(createResponse.status).toBe(201);
		expect(createPayload.conversation.id).toBeTruthy();

		const listResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations", {
				headers: {
					cookie: cookieHeader,
				},
			}),
		);
		const listPayload = (await readJson(listResponse)) as {
			conversations: Array<{ id: string }>;
		};
		expect(listResponse.status).toBe(200);
		expect(listPayload.conversations.map((conversation) => conversation.id)).toContain(
			createPayload.conversation.id,
		);

		const detailResponse = await app.fetch(
			new Request(
				`https://app-api.internal/api/chat/conversations/${createPayload.conversation.id}`,
				{
					headers: {
						cookie: cookieHeader,
					},
				},
			),
		);
		const detailPayload = (await readJson(detailResponse)) as {
			conversation: { id: string; messages: unknown[] };
		};

		expect(detailResponse.status).toBe(200);
		expect(detailPayload.conversation.id).toBe(createPayload.conversation.id);
		expect(detailPayload.conversation.messages).toEqual([]);
	});

	it("persists curriculum session slots in chat.session_slots after finalized curriculum completion", async () => {
		const createdEmail = `integration-${Date.now()}@example.edu`;
		const authShellOrigin = readIntegrationAuthShellOrigin(env);

		const authResponse = await app.fetch(
			new Request("https://app-api.internal/api/auth/sign-up/email", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: authShellOrigin,
					referer: `${authShellOrigin}/login`,
					"x-campus-legal-accepted": "terms-and-privacy",
					"x-captcha-response": TURNSTILE_TEST_TOKEN,
				},
				body: JSON.stringify({
					email: createdEmail,
					name: "Integration Student",
					password: "password12345",
				}),
			}),
		);

		expect(authResponse.ok).toBe(true);
		const cookieHeader = buildCookieHeader(authResponse);

		const createResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations", {
				method: "POST",
				headers: {
					cookie: cookieHeader,
				},
			}),
		);
		const createPayload = (await readJson(createResponse)) as {
			conversation: { id: string };
		};
		expect(createResponse.status).toBe(201);

		const executionClient: {
			execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
		} = {
			execute: vi
				.fn()
				.mockImplementationOnce(async (input: ToolExecutionInput) => ({
					answerText: "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
					error: null,
					followUpQuestion: "",
					resolvedTargets: ["curriculum"],
					sessionUpdate: {
						upsertSlots: [
							{ confirmed: true, name: "curriculum_program_family", value: "民族实验班" },
							{ confirmed: true, name: "curriculum_program", value: "法学民族实验班" },
							{ confirmed: true, name: "curriculum_semester", value: "第四学期" },
						],
					},
					result: {
						diagnostics: {
							resolved_program_family_title: "民族班",
							resolved_entity_type: "program",
							rewritten_query: "法学民族实验班培养方案里第四学期有什么课",
							session_program_family: "民族实验班",
							session_program: "法学民族实验班",
							session_semester: "第四学期",
						},
						evidence: {
							sources: [{ doc_id: "curriculum:法学（民族实验班）本科人才培养方案" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: input.traceId,
				}))
				.mockImplementationOnce(async (input: ToolExecutionInput) => ({
					answerText: "第二学期有中国法制史。",
					error: null,
					followUpQuestion: "",
					resolvedTargets: ["curriculum"],
					sessionUpdate: {
						upsertSlots: [
							{ confirmed: true, name: "curriculum_program_family", value: "民族实验班" },
							{ confirmed: true, name: "curriculum_program", value: "法学民族实验班" },
							{ confirmed: true, name: "curriculum_semester", value: "第二学期" },
						],
					},
					result: {
						diagnostics: {
							resolved_program_family_title: "民族班",
							resolved_entity_type: "program",
							rewritten_query: "法学民族实验班培养方案里第二学期有什么课",
							session_program_family: "民族实验班",
							session_program: "法学民族实验班",
							session_semester: "第二学期",
						},
						evidence: {
							sources: [{ doc_id: "curriculum:法学（民族实验班）本科人才培养方案" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: input.traceId,
				})),
		};
		let chatCommandService: ReturnType<typeof buildChatCommandService>;
		const executionRuntime = createExecutionRuntimeFromToolClient(executionClient, {
			onProductFinalization: async ({ response, runId, traceId }) => {
				const finalizedResponse = { ...response, traceId };
				const finalizationFingerprint = createHash("sha256")
					.update(`${runId}\0${JSON.stringify(finalizedResponse)}`, "utf8")
					.digest("hex");
				await chatCommandService.applyProductFinalization?.({
					completedAt: new Date().toISOString(),
					finalizationFingerprint,
					response: finalizedResponse,
					runId,
				});
			},
		});
		chatCommandService = buildChatCommandService({
			conversationStore: createPgChatConversationStore(env),
			store: createPgChatCommandStore(env),
			executionRuntime,
		});
		const appWithRealCommand = createApp(env, {
			chatCommandService,
		});

		const firstRequestResponse = await appWithRealCommand.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: cookieHeader,
				},
				body: JSON.stringify({
					conversationId: createPayload.conversation.id,
					prompt: "法学民族班培养方案里大二下有什么课",
				}),
			}),
		);
		const firstRequestPayload = await readJson(firstRequestResponse);

		expect(firstRequestResponse.status, JSON.stringify(firstRequestPayload)).toBe(200);

		const secondRequestResponse = await appWithRealCommand.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: cookieHeader,
				},
				body: JSON.stringify({
					conversationId: createPayload.conversation.id,
					prompt: "那大一下呢",
				}),
			}),
		);
		const secondRequestPayload = await readJson(secondRequestResponse);

		expect(secondRequestResponse.status, JSON.stringify(secondRequestPayload)).toBe(200);

		const dbClient = requireClient(client);
		const slotRows = await dbClient.query(
			`
        select "name", "value", "confirmed"
        from "chat"."session_slots"
        where "conversation_id" = $1
        order by "name" asc
      `,
			[createPayload.conversation.id],
		);

		expect(slotRows.rows).toEqual([
			{
				confirmed: true,
				name: "curriculum_program",
				value: "法学民族实验班",
			},
			{
				confirmed: true,
				name: "curriculum_program_family",
				value: "民族实验班",
			},
			{
				confirmed: true,
				name: "curriculum_semester",
				value: "第二学期",
			},
		]);
	});

	it("serializes profile-memory idempotency, dispatch and scope-head reconciliation", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `memory-owner-${suffix}`;
		const firstEnv = buildSharedDbIntegrationEnv({
			runtimeConnectionString: postgres.runtimeConnectionString,
		});
		const secondEnv = buildSharedDbIntegrationEnv({
			runtimeConnectionString: postgres.runtimeConnectionString,
		});
		const firstStore = createPgProfileMemoryStore(firstEnv);
		const secondStore = createPgProfileMemoryStore(secondEnv);
		const mutationIdentity = {
			idempotencyKeyHash: `idem-${suffix}`,
			requestFingerprint: `request-${suffix}`,
		};
		const [firstCreate, replayedCreate] = await Promise.all([
			firstStore.createItem({
				commandId: `command-create-a-${suffix}`,
				...mutationIdentity,
				itemId: `item-a-${suffix}`,
				key: "answer_style",
				ownerUserId,
				updatedAt: "2026-07-16T01:00:00.000Z",
				value: "先给结论",
			}),
			secondStore.createItem({
				commandId: `command-create-b-${suffix}`,
				...mutationIdentity,
				itemId: `item-b-${suffix}`,
				key: "answer_style",
				ownerUserId,
				updatedAt: "2026-07-16T01:00:00.000Z",
				value: "先给结论",
			}),
		]);
		expect(replayedCreate.item?.itemId).toBe(firstCreate.item?.itemId);

		const itemId = firstCreate.item?.itemId;
		if (!itemId) {
			throw new Error("profile-memory integration create did not return an item");
		}
		await firstStore.updateItem({
			commandId: `command-update-1-${suffix}`,
			idempotencyKeyHash: `idem-update-1-${suffix}`,
			itemId,
			key: "answer_style",
			ownerUserId,
			requestFingerprint: `request-update-1-${suffix}`,
			updatedAt: "2026-07-16T01:01:00.000Z",
			value: "先给最终结论",
		});
		const firstAdmissions = await firstStore.listPendingAdmissions({ limit: 20 });
		expect(firstAdmissions.filter((command) => command.ownerUserId === ownerUserId)).toEqual([
			expect.objectContaining({
				commandId: `command-update-1-${suffix}`,
				item: { key: "answer_style", value: "先给最终结论" },
				schemaVersion: "personal_memory_command.v2",
				supersessionScope: `item:${itemId}`,
			}),
		]);
		await firstStore.markCommandAdmitted({
			admittedAt: "2026-07-16T01:01:10.000Z",
			commandId: `command-update-1-${suffix}`,
			workflowId: `memory-workflow-1-${suffix}`,
		});
		await firstStore.updateItem({
			commandId: `command-update-2-${suffix}`,
			idempotencyKeyHash: `idem-update-2-${suffix}`,
			itemId,
			key: "answer_style",
			ownerUserId,
			requestFingerprint: `request-update-2-${suffix}`,
			updatedAt: "2026-07-16T01:02:00.000Z",
			value: "先给一句结论",
		});
		expect(
			(await firstStore.listPendingAdmissions({ limit: 20 })).filter(
				(command) => command.ownerUserId === ownerUserId,
			),
		).toEqual([]);

		const superseded = await firstStore.applyCommandResult({
			commandId: `command-update-1-${suffix}`,
			resultFingerprint: "a".repeat(64),
			status: "succeeded",
			updatedAt: "2026-07-16T01:03:00.000Z",
		});
		expect(superseded).toBe("superseded");
		expect(
			await firstStore.applyCommandResult({
				commandId: `command-update-1-${suffix}`,
				resultFingerprint: "a".repeat(64),
				status: "succeeded",
				updatedAt: "2026-07-16T01:03:01.000Z",
			}),
		).toBe("replayed");
		expect(
			(await firstStore.listPendingAdmissions({ limit: 20 })).filter(
				(command) => command.ownerUserId === ownerUserId,
			),
		).toEqual([expect.objectContaining({ commandId: `command-update-2-${suffix}` })]);

		await firstStore.applyCommandResult({
			commandId: `command-update-2-${suffix}`,
			resultFingerprint: "b".repeat(64),
			status: "succeeded",
			updatedAt: "2026-07-16T01:04:00.000Z",
		});
		expect(await firstStore.loadSummary({ ownerUserId })).toMatchObject({
			enabled: true,
			syncStatus: "synced",
		});

		const dbClient = requireClient(client);
		const commandRows = await dbClient.query<{
			accepted_item_value: string | null;
			command_id: string;
			reported_result_status: string | null;
			status: string;
		}>(
			`
			select "command_id", "status", "reported_result_status", "accepted_item_value"
			from "profile"."memory_commands"
			where "owner_user_id" = $1
			order by "owner_sequence"
		`,
			[ownerUserId],
		);
		expect(commandRows.rows).toHaveLength(3);
		expect(commandRows.rows[1]).toEqual({
			accepted_item_value: null,
			command_id: `command-update-1-${suffix}`,
			reported_result_status: "succeeded",
			status: "superseded",
		});
		expect(commandRows.rows.every((row) => row.accepted_item_value === null)).toBe(true);

		await firstStore.updateItem({
			commandId: `command-update-before-erase-${suffix}`,
			idempotencyKeyHash: `idem-update-before-erase-${suffix}`,
			itemId,
			key: "answer_style",
			ownerUserId,
			requestFingerprint: `request-update-before-erase-${suffix}`,
			updatedAt: "2026-07-16T01:05:00.000Z",
			value: "这段快照必须在 erase 时清除",
		});
		const beforeErase = await dbClient.query<{ accepted_item_value: string | null }>(
			`
			select "accepted_item_value"
			from "profile"."memory_commands"
			where "command_id" = $1
		`,
			[`command-update-before-erase-${suffix}`],
		);
		expect(beforeErase.rows[0]?.accepted_item_value).toBe("这段快照必须在 erase 时清除");

		await firstStore.erase({
			commandId: `command-erase-${suffix}`,
			idempotencyKeyHash: `idem-erase-${suffix}`,
			ownerUserId,
			requestFingerprint: `request-erase-${suffix}`,
			updatedAt: "2026-07-16T01:06:00.000Z",
		});
		const afterErase = await dbClient.query<{ retained_snapshots: string }>(
			`
			select count(*) filter (
				where "accepted_item_key" is not null or "accepted_item_value" is not null
			)::text as retained_snapshots
			from "profile"."memory_commands"
			where "owner_user_id" = $1
		`,
			[ownerUserId],
		);
		expect(afterErase.rows[0]?.retained_snapshots).toBe("0");
		expect(
			await firstStore.applyCommandResult({
				commandId: `command-erase-${suffix}`,
				resultFingerprint: "c".repeat(64),
				status: "succeeded",
				updatedAt: "2026-07-16T01:07:00.000Z",
			}),
		).toBe("applied");
		await expect(
			firstStore.createItem({
				commandId: `command-create-after-erase-${suffix}`,
				idempotencyKeyHash: `idem-create-after-erase-${suffix}`,
				itemId: `item-after-erase-${suffix}`,
				key: "recent_goal",
				ownerUserId,
				requestFingerprint: `request-create-after-erase-${suffix}`,
				updatedAt: "2026-07-16T01:08:00.000Z",
				value: "不应生成 outbox",
			}),
		).rejects.toMatchObject({ code: "profile_memory_not_ready" });
		await expect(
			firstStore.setLifecycle({
				commandId: `command-pause-after-erase-${suffix}`,
				idempotencyKeyHash: `idem-pause-after-erase-${suffix}`,
				lifecycleState: "paused",
				ownerUserId,
				requestFingerprint: `request-pause-after-erase-${suffix}`,
				updatedAt: "2026-07-16T01:08:30.000Z",
			}),
		).rejects.toMatchObject({ code: "profile_memory_not_ready" });
		await expect(
			firstStore.setLifecycle({
				commandId: `command-reactivate-${suffix}`,
				idempotencyKeyHash: `idem-reactivate-${suffix}`,
				lifecycleState: "active",
				ownerUserId,
				requestFingerprint: `request-reactivate-${suffix}`,
				updatedAt: "2026-07-16T01:09:00.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "active" });
		expect(await firstStore.loadSummary({ ownerUserId })).toMatchObject({
			enabled: false,
			lifecycleState: "active",
			syncStatus: "pending",
		});
	});

	it("keeps conversation source batches independent and scrubs them after callback", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `source-owner-${suffix}`;
		const conversationId = `source-conversation-${suffix}`;
		const chatStore = createPgChatConversationStore(env);
		await chatStore.createConversationDraft({
			conversationId,
			createdAt: "2026-07-16T02:00:00.000Z",
			ownerUserId,
			title: "Source deletion integration",
			updatedAt: "2026-07-16T02:00:00.000Z",
		});
		const dbClient = requireClient(client);
		await dbClient.query(
			`
				insert into "chat"."messages" (
					"id", "conversation_id", "role", "text", "created_at"
				)
				select $2 || source_index::text, $1, 'user', 'source message ' || source_index::text,
				       '2026-07-16T02:00:00Z'::timestamptz + source_index * interval '1 millisecond'
				from generate_series(1, 51) source_index
			`,
			[conversationId, `source-message-${suffix}-`],
		);
		expect(
			await chatStore.markConversationDeletedByOwner({
				conversationId,
				deletedAt: "2026-07-16T02:01:00.000Z",
				ownerUserId,
				updatedAt: "2026-07-16T02:01:00.000Z",
			}),
		).toBe(true);

		const commandRows = await dbClient.query<{
			command_id: string;
			source_count: string;
			supersession_scope: string;
		}>(
			`
				select command."command_id", command."supersession_scope", count(source."command_id")::text as source_count
				from "profile"."memory_commands" command
				join "profile"."memory_command_sources" source using ("command_id")
				where command."owner_user_id" = $1
				group by command."command_id", command."owner_sequence", command."supersession_scope"
				order by command."owner_sequence"
			`,
			[ownerUserId],
		);
		expect(commandRows.rows.map((row) => row.source_count)).toEqual(["50", "1"]);
		expect(new Set(commandRows.rows.map((row) => row.supersession_scope)).size).toBe(2);
		for (const row of commandRows.rows) {
			expect(row.supersession_scope).toBe(`source_batch:${row.command_id}`);
		}

		const memoryStore = createPgProfileMemoryStore(env);
		expect(
			await memoryStore.applyCommandResult({
				commandId: commandRows.rows[0]?.command_id ?? "",
				resultFingerprint: "d".repeat(64),
				status: "succeeded",
				updatedAt: "2026-07-16T02:02:00.000Z",
			}),
		).toBe("applied");
		expect(
			await memoryStore.applyCommandResult({
				commandId: commandRows.rows[1]?.command_id ?? "",
				resultFingerprint: "e".repeat(64),
				status: "succeeded",
				updatedAt: "2026-07-16T02:03:00.000Z",
			}),
		).toBe("applied");
		const retainedSources = await dbClient.query<{ count: string }>(
			`
				select count(*)::text as count
				from "profile"."memory_command_sources" source
				join "profile"."memory_commands" command using ("command_id")
				where command."owner_user_id" = $1
			`,
			[ownerUserId],
		);
		expect(retainedSources.rows[0]?.count).toBe("0");
		expect(await memoryStore.loadSummary({ ownerUserId })).toMatchObject({
			enabled: true,
			syncStatus: "synced",
		});
	});

	it("projects conversation prune sources without applying an item revision fence", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `prune-owner-${suffix}`;
		const conversationId = `prune-conversation-${suffix}`;
		const sourcePrefix = `prune-message-${suffix}-`;
		const chatStore = createPgChatConversationStore(env);
		await chatStore.createConversationDraft({
			conversationId,
			createdAt: "2026-07-16T03:00:00.000Z",
			ownerUserId,
			title: "Source prune integration",
			updatedAt: "2026-07-16T03:00:00.000Z",
		});
		const dbClient = requireClient(client);
		await dbClient.query(
			`
				insert into "chat"."messages" (
					"id", "conversation_id", "role", "text", "created_at"
				)
				select $2 || source_index::text, $1, 'user', 'source message ' || source_index::text,
				       '2026-07-16T03:00:00Z'::timestamptz + source_index * interval '1 second'
				from generate_series(1, 3) source_index
			`,
			[conversationId, sourcePrefix],
		);

		expect(
			await chatStore.deleteTrailingMessagesFromMessageByOwner({
				conversationId,
				messageId: `${sourcePrefix}2`,
				ownerUserId,
				updatedAt: "2026-07-16T03:01:00.000Z",
			}),
		).toBe(true);

		const remainingMessages = await dbClient.query<{ id: string }>(
			`
				select "id"
				from "chat"."messages"
				where "conversation_id" = $1
				order by "created_at", "id"
			`,
			[conversationId],
		);
		expect(remainingMessages.rows).toEqual([{ id: `${sourcePrefix}1` }]);

		const memoryStore = createPgProfileMemoryStore(env);
		const pending = (await memoryStore.listPendingAdmissions({ limit: 20 })).filter(
			(command) => command.ownerUserId === ownerUserId,
		);
		expect(pending).toEqual([
			expect.objectContaining({
				commandKind: "conversation_prune",
				sourceMessageIds: [`${sourcePrefix}2`, `${sourcePrefix}3`],
				subjectId: conversationId,
			}),
		]);
		const commandId = pending[0]?.commandId;
		if (!commandId) {
			throw new Error("conversation prune did not produce a memory command");
		}
		expect(
			await memoryStore.markCommandAdmitted({
				admittedAt: "2026-07-16T03:01:30.000Z",
				commandId,
				workflowId: `prune-workflow-${suffix}`,
			}),
		).toBe(true);
		expect(
			await memoryStore.applyCommandResult({
				commandId,
				resultFingerprint: "f".repeat(64),
				status: "succeeded",
				updatedAt: "2026-07-16T03:02:00.000Z",
			}),
		).toBe("applied");

		const retainedSources = await dbClient.query<{ count: string }>(
			`
				select count(*)::text as count
				from "profile"."memory_command_sources"
				where "command_id" = $1
			`,
			[commandId],
		);
		expect(retainedSources.rows[0]?.count).toBe("0");
		expect(await memoryStore.loadSummary({ ownerUserId })).toMatchObject({
			enabled: true,
			syncStatus: "synced",
		});
	});
});
