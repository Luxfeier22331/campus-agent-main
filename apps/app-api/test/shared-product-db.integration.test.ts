// @vitest-environment node

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createApp } from "../src/app";
import type { Env } from "../src/config";
import { createAppAuth } from "../src/modules/auth";
import { createPgChatConversationStore } from "../src/modules/chat";
import { createPgProfileMemoryPersistence } from "../src/modules/profile-memory";
import { createPgChatCommandPersistence } from "../src/modules/runtime-command";
import {
	buildAcceptedWrite,
	buildFinalizedWrite,
} from "../src/modules/runtime-command/service/writes";
import { createPrincipal } from "./chat-command.service.test-support";
import { buildSharedDbIntegrationEnv } from "./shared-db-integration-helpers";

function createPgProfileMemoryStore(...args: Parameters<typeof createPgProfileMemoryPersistence>) {
	const persistence = createPgProfileMemoryPersistence(...args);
	return {
		...persistence.commands,
		...persistence.mutations,
		...persistence.reads,
	};
}

function createPgChatCommandStore(...args: Parameters<typeof createPgChatCommandPersistence>) {
	const persistence = createPgChatCommandPersistence(...args);
	return {
		...persistence.commands,
		...persistence.observability,
	};
}

const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const postgres = inject("appApiPostgres");

interface CapturedEmail {
	subject: string;
	text: string;
	to: string;
}

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

function verificationUrl(emails: CapturedEmail[], email: string): URL {
	const message = [...emails]
		.reverse()
		.find(
			(candidate) => candidate.subject === "验证中央民族大学校园问答邮箱" && candidate.to === email,
		);
	if (!message) {
		throw new Error(`Expected a verification email for ${email}.`);
	}
	const url = message.text
		.split(/\s+/u)
		.find((value) => value.includes("/api/auth/verify-email?token="));
	if (!url) {
		throw new Error(`Expected a verification URL for ${email}.`);
	}
	return new URL(url);
}

describe("app-api shared product DB integration", () => {
	let app: ReturnType<typeof createApp>;
	let auth: ReturnType<typeof createAppAuth>;
	let client: Client | null = null;
	let env: Env;
	const emails: CapturedEmail[] = [];

	async function registerAndSignIn(email: string): Promise<string> {
		const authShellOrigin = readIntegrationAuthShellOrigin(env);
		const signUpResponse = await app.fetch(
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
					email,
					name: "Integration Student",
					password: "password12345",
				}),
			}),
		);
		if (!signUpResponse.ok) {
			throw new Error(
				`Expected sign-up to succeed, received ${signUpResponse.status}: ${await signUpResponse.text()}`,
			);
		}
		const verificationEmailResponse = await app.fetch(
			new Request("https://app-api.internal/api/auth/send-verification-email", {
				body: JSON.stringify({ callbackURL: "/account", email }),
				headers: {
					"content-type": "application/json",
					origin: authShellOrigin,
					referer: `${authShellOrigin}/account/register`,
				},
				method: "POST",
			}),
		);
		if (!verificationEmailResponse.ok) {
			throw new Error(
				`Expected verification email request to succeed, received ${verificationEmailResponse.status}: ${await verificationEmailResponse.text()}`,
			);
		}

		const verificationResponse = await app.fetch(new Request(verificationUrl(emails, email)));
		if (verificationResponse.status !== 302) {
			throw new Error(
				`Expected verification to redirect, received ${verificationResponse.status}: ${await verificationResponse.text()}`,
			);
		}

		const signInResponse = await app.fetch(
			new Request("https://app-api.internal/api/auth/sign-in/email", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: authShellOrigin,
					referer: `${authShellOrigin}/login`,
					"x-captcha-response": TURNSTILE_TEST_TOKEN,
				},
				body: JSON.stringify({ email, password: "password12345" }),
			}),
		);
		if (!signInResponse.ok) {
			throw new Error(
				`Expected sign-in to succeed, received ${signInResponse.status}: ${await signInResponse.text()}`,
			);
		}
		return buildCookieHeader(signInResponse);
	}

	beforeAll(async () => {
		env = buildSharedDbIntegrationEnv({
			runtimeConnectionString: postgres.runtimeConnectionString,
		});

		auth = createAppAuth(env, {
			emailSender: {
				async send(message) {
					emails.push({ subject: message.subject, text: message.text, to: message.to });
					return { id: `shared-db-email-${emails.length}` };
				},
			},
		});
		app = createApp(env, { getAppAuth: () => auth });
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

	it("persists and enforces Better Auth rate limits in deployed mode", async () => {
		const dbClient = requireClient(client);
		await dbClient.query(`delete from "app_auth"."rateLimit"`);
		const deployedEnv = buildSharedDbIntegrationEnv({
			runtimeConnectionString: postgres.runtimeConnectionString,
			overrides: { DEPLOYMENT_ENVIRONMENT: "staging" },
		});
		const deployedAuth = createAppAuth(deployedEnv);
		const deployedApp = createApp(deployedEnv, { getAppAuth: () => deployedAuth });
		const request = () =>
			new Request("https://app-api.internal/api/auth/get-session", {
				headers: { "cf-connecting-ip": "198.51.100.42" },
			});

		const firstResponse = await deployedApp.fetch(request());
		expect(firstResponse.status).toBe(200);
		await expect(firstResponse.json()).resolves.toBeNull();
		const firstRows = await dbClient.query<{
			count: number;
			id: string;
			key: string;
			last_request: string;
		}>(`
			select "id", "key", "count", "lastRequest"::text as last_request
			from "app_auth"."rateLimit"
		`);
		expect(firstRows.rows).toHaveLength(1);
		const firstRow = firstRows.rows[0];
		expect(firstRow).toMatchObject({ count: 1 });
		expect(firstRow?.id).toBeTruthy();
		expect(firstRow?.key).toBeTruthy();

		const secondResponse = await deployedApp.fetch(request());
		expect(secondResponse.status).toBe(200);
		const secondRows = await dbClient.query<{
			count: number;
			id: string;
			key: string;
			last_request: string;
		}>(`
			select "id", "key", "count", "lastRequest"::text as last_request
			from "app_auth"."rateLimit"
		`);
		expect(secondRows.rows).toHaveLength(1);
		expect(secondRows.rows[0]).toMatchObject({
			count: 2,
			id: firstRow?.id,
			key: firstRow?.key,
		});
		expect(Number(secondRows.rows[0]?.last_request)).toBeGreaterThanOrEqual(
			Number(firstRow?.last_request),
		);

		for (let requestCount = 3; requestCount <= 10; requestCount += 1) {
			expect((await deployedApp.fetch(request())).status).toBe(200);
		}
		const limitedResponse = await deployedApp.fetch(request());
		expect(limitedResponse.status).toBe(429);
		await expect(
			dbClient.query<{ count: number }>(
				`select "count" from "app_auth"."rateLimit" where "id" = $1`,
				[firstRow?.id],
			),
		).resolves.toMatchObject({ rows: [{ count: 10 }] });
	});

	it("creates and reads owned conversations through app-api after Better Auth sign-in", async () => {
		const createdEmail = `integration-${Date.now()}@muc.edu.cn`;
		const cookieHeader = await registerAndSignIn(createdEmail);

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

	it("searches each conversation once and returns the latest message match snippet", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `search-owner-${suffix}`;
		const firstConversationId = `search-first-${suffix}`;
		const secondConversationId = `search-second-${suffix}`;
		const otherConversationId = `search-other-${suffix}`;
		const literalMessageText = `${"前文".repeat(60)}100% literal_underscore\\literal${"后文".repeat(60)}`;
		const chatStore = createPgChatConversationStore(env);
		for (const [conversationId, title, updatedAt] of [
			[firstConversationId, "不相关标题", "2026-07-16T03:00:00.000Z"],
			[secondConversationId, "命中词标题", "2026-07-16T02:00:00.000Z"],
			[otherConversationId, "普通会话", "2026-07-16T01:00:00.000Z"],
		] as const) {
			await chatStore.createConversationDraft({
				conversationId,
				createdAt: updatedAt,
				ownerUserId,
				title,
				updatedAt,
			});
		}
		const dbClient = requireClient(client);
		await dbClient.query(
			`
				insert into "chat"."messages" ("id", "conversation_id", "role", "text", "created_at")
				values
					($1, $2, 'user', '命中词较早的一条消息', '2026-07-16T03:01:00Z'),
					($3, $2, 'user', '这是命中词最新的一条消息，包含更多上下文', '2026-07-16T03:02:00Z'),
					($4, $5, 'user', '另一个会话也包含命中词', '2026-07-16T02:01:00Z'),
					($6, $7, 'user', $8, '2026-07-16T01:01:00Z')
			`,
			[
				`message-old-${suffix}`,
				firstConversationId,
				`message-new-${suffix}`,
				`message-second-${suffix}`,
				secondConversationId,
				`message-literal-${suffix}`,
				otherConversationId,
				literalMessageText,
			],
		);
		await dbClient.query(
			`
				insert into "chat"."messages" ("id", "conversation_id", "role", "text", "created_at")
				select
					concat('message-duplicate-', duplicate_index, '-', $2::text),
					$1,
					'user',
					concat('命中词重复消息 ', duplicate_index),
					'2026-07-16T02:00:00Z'::timestamptz + duplicate_index * interval '1 second'
				from generate_series(1, 8) as duplicate_index
			`,
			[firstConversationId, suffix],
		);

		await expect(
			chatStore.searchConversationSummariesByOwner({
				limit: 2,
				ownerUserId,
				query: "命中词",
				view: "active",
			}),
		).resolves.toEqual([
			expect.objectContaining({
				id: firstConversationId,
				matchSnippet: "这是命中词最新的一条消息，包含更多上下文",
			}),
			expect.objectContaining({ id: secondConversationId, matchSnippet: null }),
		]);

		const literalResults = await chatStore.searchConversationSummariesByOwner({
			limit: 10,
			ownerUserId,
			query: "100% literal_",
			view: "active",
		});
		expect(literalResults).toEqual([expect.objectContaining({ id: otherConversationId })]);
		expect(literalResults[0]?.matchSnippet).toContain("100% literal_");
		expect(literalResults[0]?.matchSnippet?.length).toBeLessThanOrEqual(160);
		await expect(
			chatStore.searchConversationSummariesByOwner({
				limit: 10,
				ownerUserId,
				query: "\\literal",
				view: "active",
			}),
		).resolves.toEqual([expect.objectContaining({ id: otherConversationId })]);
	});

	it("converges TTFT timing across finalization order and preserves the first observation", async () => {
		const store = createPgChatCommandStore(env);
		const dbClient = requireClient(client);
		const principal = createPrincipal();

		async function runOrder(
			order: "finalization_first" | "ttft_after_finalization_snapshot" | "ttft_first",
		) {
			const suffix = `${order}-${Date.now().toString(36)}`;
			const acceptedAt = "2026-07-16T04:00:00.000Z";
			const completedAt = "2026-07-16T04:00:03.000Z";
			const firstTtftObservedAt =
				order === "ttft_first" ? "2026-07-16T04:00:01.000Z" : "2026-07-16T04:00:04.000Z";
			const conversationId = `timing-conversation-${suffix}`;
			const requestId = `timing-request-${suffix}`;
			const conversation = {
				activeBranchId: "branch_active",
				activeMessageId: null,
				activeRequestId: null,
				activeTurnSequence: 0,
				createdAt: acceptedAt,
				id: conversationId,
				messages: [],
				ownerUserId: principal.actor.userId,
				sessionSlots: [],
				title: "TTFT integration",
				updatedAt: acceptedAt,
			};
			const acceptedWrite = buildAcceptedWrite({
				assistantMessageId: `timing-assistant-${suffix}`,
				branchId: "branch_active",
				conversation,
				conversationSeed: {
					createdAt: acceptedAt,
					id: conversationId,
					ownerUserId: principal.actor.userId,
					title: conversation.title,
					updatedAt: acceptedAt,
				},
				conversationTitle: conversation.title,
				freezeDurableRun: () => ({
					executionInputJson: JSON.stringify({ requestId }),
					executionInputSha256: "b".repeat(64),
				}),
				idempotencyKey: null,
				now: acceptedAt,
				principal,
				prompt: "国家奖学金怎么评审？",
				requestFingerprintSha256: null,
				requestId,
				requestKind: "internal_eval",
				safetyIdentifier: null,
				surface: "campus_web",
				turnSequence: 1,
				userMessageId: `timing-user-${suffix}`,
			});
			await store.acceptRequest(acceptedWrite);
			const recordTtft = () =>
				store.recordStreamAppApiTtft({
					durationMs: 1000,
					observedAt: firstTtftObservedAt,
					requestId,
				});
			const buildFinalization = async () => {
				const finalized = buildFinalizedWrite({
					assistantMessageId: acceptedWrite.turnDispatch.assistantMessageId,
					branchId: "branch_active",
					completedAt,
					conversation: {
						...conversation,
						activeMessageId: acceptedWrite.userMessage.id,
						activeRequestId: requestId,
						activeTurnSequence: 1,
						messages: [acceptedWrite.userMessage],
						updatedAt: acceptedAt,
					},
					conversationTitle: conversation.title,
					durationMs: 3000,
					principal,
					requestId,
					response: {
						answerText: "国家奖学金每学年评审一次。",
						error: null,
						modelUsage: {
							cachedInputTokens: 0,
							inputTokens: 1,
							outputTokens: 1,
							totalTokens: 2,
						},
						result: null,
						stageTiming: { "agent.first_delta_ms": 600 },
						status: "completed",
					},
					safetyIdentifier: null,
					stageTiming: await store.readRequestStageTiming(requestId),
					startedAt: acceptedAt,
					surface: "campus_web",
					turnSequence: 1,
					userMessageId: acceptedWrite.userMessage.id,
				});
				return finalized.write;
			};
			const finalize = async () => store.finalizeRequest(await buildFinalization());

			if (order === "ttft_first") {
				expect(await recordTtft()).toBe(true);
				await finalize();
			} else if (order === "finalization_first") {
				await finalize();
				expect(await recordTtft()).toBe(true);
			} else {
				const staleFinalization = await buildFinalization();
				expect(await recordTtft()).toBe(true);
				await store.finalizeRequest(staleFinalization);
			}

			const firstRow = await dbClient.query<{
				stage_timing: Record<string, unknown>;
				updated_at: string;
			}>(
				`
					select "stage_timing_json" as stage_timing, "updated_at"::text as updated_at
					from "runtime"."request_observability_fact"
					where "request_id" = $1
				`,
				[requestId],
			);
			expect(
				await store.recordStreamAppApiTtft({
					durationMs: 2000,
					observedAt: "2026-07-16T04:00:05.000Z",
					requestId,
				}),
			).toBe(false);
			const duplicateRow = await dbClient.query<{
				stage_timing: Record<string, unknown>;
				updated_at: string;
			}>(
				`
					select "stage_timing_json" as stage_timing, "updated_at"::text as updated_at
					from "runtime"."request_observability_fact"
					where "request_id" = $1
				`,
				[requestId],
			);
			expect(duplicateRow.rows[0]).toEqual(firstRow.rows[0]);
			return firstRow.rows[0];
		}

		const ttftFirst = await runOrder("ttft_first");
		const finalizationFirst = await runOrder("finalization_first");
		const ttftAfterFinalizationSnapshot = await runOrder("ttft_after_finalization_snapshot");
		expect(ttftFirst?.stage_timing).toEqual({
			"agent.first_delta_ms": 600,
			"request.total_ms": 3000,
			"stream.app_api_ttft_ms": 1000,
			"stream.orchestration_overhead_ms": 400,
		});
		expect(finalizationFirst?.stage_timing).toEqual(ttftFirst?.stage_timing);
		expect(ttftAfterFinalizationSnapshot?.stage_timing).toEqual(ttftFirst?.stage_timing);
		expect(new Date(ttftFirst?.updated_at ?? 0).valueOf()).toBe(
			new Date("2026-07-16T04:00:03.000Z").valueOf(),
		);
		expect(new Date(finalizationFirst?.updated_at ?? 0).valueOf()).toBe(
			new Date("2026-07-16T04:00:04.000Z").valueOf(),
		);
		expect(new Date(ttftAfterFinalizationSnapshot?.updated_at ?? 0).valueOf()).toBe(
			new Date("2026-07-16T04:00:04.000Z").valueOf(),
		);
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
		expect(await firstStore.listByOwner(ownerUserId)).toMatchObject({
			lifecycleState: "active",
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
		expect(await firstStore.listByOwner(ownerUserId)).toMatchObject({
			lifecycleState: "active",
			syncStatus: "pending",
		});
		await expect(
			firstStore.erase({
				commandId: `command-erase-after-reactivate-${suffix}`,
				idempotencyKeyHash: `idem-erase-after-reactivate-${suffix}`,
				ownerUserId,
				requestFingerprint: `request-erase-after-reactivate-${suffix}`,
				updatedAt: "2026-07-16T01:10:00.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erasing", syncStatus: "pending" });
		const reeraseRows = await dbClient.query<{ owner_generation: number }>(
			`
			select "owner_generation"::int
			from "profile"."memory_commands"
			where "command_id" = $1
			`,
			[`command-erase-after-reactivate-${suffix}`],
		);
		expect(reeraseRows.rows[0]?.owner_generation).toBe(3);
	});

	it("coalesces repeated erase requests and retries failed erase in the same generation", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `erase-owner-${suffix}`;
		const store = createPgProfileMemoryStore(
			buildSharedDbIntegrationEnv({ runtimeConnectionString: postgres.runtimeConnectionString }),
		);
		const dbClient = requireClient(client);

		await expect(
			store.erase({
				commandId: `erase-first-${suffix}`,
				idempotencyKeyHash: `erase-idem-first-${suffix}`,
				ownerUserId,
				requestFingerprint: `erase-request-first-${suffix}`,
				updatedAt: "2026-07-16T05:00:00.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erasing", syncStatus: "pending" });

		await expect(
			store.erase({
				commandId: `erase-pending-duplicate-${suffix}`,
				idempotencyKeyHash: `erase-idem-pending-${suffix}`,
				ownerUserId,
				requestFingerprint: `erase-request-pending-${suffix}`,
				updatedAt: "2026-07-16T05:00:01.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erasing", syncStatus: "pending" });

		let commandRows = await dbClient.query<{
			command_id: string;
			owner_generation: number;
			owner_sequence: number;
			status: string;
		}>(
			`
			select "command_id", "owner_generation"::int, "owner_sequence"::int, "status"
			from "profile"."memory_commands"
			where "owner_user_id" = $1 and "command_kind" = 'owner_erase'
			order by "owner_sequence"
			`,
			[ownerUserId],
		);
		expect(commandRows.rows).toEqual([
			{
				command_id: `erase-first-${suffix}`,
				owner_generation: 2,
				owner_sequence: 1,
				status: "pending_admission",
			},
		]);

		await store.markCommandAdmitted({
			admittedAt: "2026-07-16T05:00:02.000Z",
			commandId: `erase-first-${suffix}`,
		});
		await expect(
			store.erase({
				commandId: `erase-admitted-duplicate-${suffix}`,
				idempotencyKeyHash: `erase-idem-admitted-${suffix}`,
				ownerUserId,
				requestFingerprint: `erase-request-admitted-${suffix}`,
				updatedAt: "2026-07-16T05:00:03.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erasing", syncStatus: "pending" });

		await expect(
			store.applyCommandResult({
				commandId: `erase-first-${suffix}`,
				errorCode: "personal_memory_command_failed",
				resultFingerprint: "a".repeat(64),
				status: "failed",
				updatedAt: "2026-07-16T05:00:04.000Z",
			}),
		).resolves.toBe("applied");

		await expect(
			store.erase({
				commandId: `erase-retry-${suffix}`,
				idempotencyKeyHash: `erase-idem-retry-${suffix}`,
				ownerUserId,
				requestFingerprint: `erase-request-retry-${suffix}`,
				updatedAt: "2026-07-16T05:00:05.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erasing", syncStatus: "pending" });

		commandRows = await dbClient.query<{
			command_id: string;
			owner_generation: number;
			owner_sequence: number;
			status: string;
		}>(
			`
			select "command_id", "owner_generation"::int, "owner_sequence"::int, "status"
			from "profile"."memory_commands"
			where "owner_user_id" = $1 and "command_kind" = 'owner_erase'
			order by "owner_sequence"
			`,
			[ownerUserId],
		);
		expect(commandRows.rows).toEqual([
			{
				command_id: `erase-first-${suffix}`,
				owner_generation: 2,
				owner_sequence: 1,
				status: "failed",
			},
			{
				command_id: `erase-retry-${suffix}`,
				owner_generation: 2,
				owner_sequence: 2,
				status: "pending_admission",
			},
		]);

		await expect(
			store.applyCommandResult({
				commandId: `erase-retry-${suffix}`,
				resultFingerprint: "b".repeat(64),
				status: "succeeded",
				updatedAt: "2026-07-16T05:00:06.000Z",
			}),
		).resolves.toBe("applied");
		await expect(
			store.erase({
				commandId: `erase-after-success-${suffix}`,
				idempotencyKeyHash: `erase-idem-after-success-${suffix}`,
				ownerUserId,
				requestFingerprint: `erase-request-after-success-${suffix}`,
				updatedAt: "2026-07-16T05:00:07.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erased", syncStatus: "synced" });

		const commandCount = await dbClient.query<{ count: string }>(
			`
			select count(*)::text as count
			from "profile"."memory_commands"
			where "owner_user_id" = $1 and "command_kind" = 'owner_erase'
			`,
			[ownerUserId],
		);
		expect(commandCount.rows[0]?.count).toBe("2");
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
		expect(await memoryStore.listByOwner(ownerUserId)).toMatchObject({
			lifecycleState: "active",
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
		expect(await memoryStore.listByOwner(ownerUserId)).toMatchObject({
			lifecycleState: "active",
			syncStatus: "synced",
		});
	});
});
