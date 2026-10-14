// @vitest-environment node

import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
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
const runtimePool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 4 });
const runtimeDatabase = drizzle({ client: runtimePool });
const getDb = async () => runtimeDatabase;
afterAll(() => runtimePool.end());

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
			database: runtimeDatabase,
			emailSender: {
				async send(message) {
					emails.push({ subject: message.subject, text: message.text, to: message.to });
					return { id: `shared-db-email-${emails.length}` };
				},
			},
		});
		app = createApp(env, {
			runtimeScopeDependencies: { createRuntimeDatabase: getDb },
			getAppAuth: () => auth,
		});
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
		const deployedAuth = createAppAuth(deployedEnv, { database: drizzle({ client: runtimePool }) });
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
		const chatStore = createPgChatConversationStore({ getDb: getDb });
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
		const store = createPgChatCommandStore({ getDb: getDb });
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
			const recordClientTiming = () =>
				store.recordClientTiming?.({
					requestId,
					firstDeltaMs: 1100,
					firstRenderMs: 1150,
					observedAt: firstTtftObservedAt,
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
						stageTiming: { "workflow.first_delta_ms": 600 },
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
				expect(await recordClientTiming()).toBe(true);
				await finalize();
			} else if (order === "finalization_first") {
				const responseJson = JSON.stringify({
					answer_text: "国家奖学金每学年评审一次。",
					error: null,
					model_usage: {
						cached_input_tokens: 0,
						input_tokens: 1,
						output_tokens: 1,
						total_tokens: 2,
					},
					result: null,
					observability: null,
					stage_timing: { "workflow.first_delta_ms": 600 },
					status: "completed",
				});
				const callback = (json = responseJson, at = completedAt) =>
					app.request(`/api/internal/agent/runs/${requestId}/product-finalization`, {
						method: "PUT",
						headers: {
							"content-type": "application/json",
							"x-app-product-callback-auth": env.APP_API_INTERNAL_SHARED_SECRET ?? "",
						},
						body: JSON.stringify({
							completed_at: at,
							finalization_fingerprint: createHash("sha256")
								.update(`${requestId}\0${json}`)
								.digest("hex"),
							response_json: json,
						}),
					});
				const first = await callback();
				expect(first.status, await first.clone().text()).toBe(200);
				expect(await first.json()).toEqual({ outcome: "applied" });
				// A callback may be repeated after agent-control's event or CAS
				// write fails. PostgreSQL must preserve one product completion.
				const replays = await Promise.all([callback(), callback()]);
				for (const replay of replays) {
					expect(replay.status).toBe(200);
					expect(await replay.json()).toEqual({ outcome: "replayed" });
				}
				expect((await callback(responseJson, "2026-07-16T04:00:05.000Z")).status).toBe(409);
				expect((await callback(responseJson.replace("每学年", "每学期"))).status).toBe(409);
				const messages = await dbClient.query<{ count: string }>(
					'select count(*)::text as count from "chat"."messages" where "conversation_id" = $1 and "role" = $2',
					[conversationId, "assistant"],
				);
				expect(messages.rows[0]?.count).toBe("1");
				expect(await recordTtft()).toBe(true);
				expect(await recordClientTiming()).toBe(true);
			} else {
				const staleFinalization = await buildFinalization();
				expect(await recordTtft()).toBe(true);
				expect(await recordClientTiming()).toBe(true);
				await store.finalizeRequest(staleFinalization);
			}

			const conversationRow = await dbClient.query<{ active_request_id: string | null }>(
				`
					select "active_request_id"
					from "chat"."conversations"
					where "id" = $1
				`,
				[conversationId],
			);
			expect(conversationRow.rows[0]?.active_request_id).toBeNull();

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
			expect(await recordClientTiming()).toBe(false);
			return firstRow.rows[0];
		}

		const ttftFirst = await runOrder("ttft_first");
		const finalizationFirst = await runOrder("finalization_first");
		const ttftAfterFinalizationSnapshot = await runOrder("ttft_after_finalization_snapshot");
		expect(ttftFirst?.stage_timing).toEqual({
			"client.first_delta_ms": 1100,
			"client.first_render_ms": 1150,
			"workflow.first_delta_ms": 600,
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

	it("serializes commands without blocking chat memory and retains failed payloads for explicit retry", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `memory-owner-${suffix}`;
		const first = createPgProfileMemoryStore({ getDb: getDb });
		const second = createPgProfileMemoryStore({ getDb: getDb });
		const base = (id: string) => ({
			commandId: `${id}-${suffix}`,
			idempotencyKeyHash: `${id}-idem-${suffix}`,
			requestFingerprint: `${id}-request-${suffix}`,
			ownerUserId,
			updatedAt: "2026-09-12T01:00:00Z",
		});
		const [accepted, replayed] = await Promise.all([
			first.submitCorrection({ ...base("add"), text: "先给结论" }),
			second.submitCorrection({
				...base("add"),
				commandId: `alternative-${suffix}`,
				text: "先给结论",
			}),
		]);
		expect(accepted.commandId).toBe(replayed.commandId);
		expect(accepted.syncStatus).toBe("synced");
		const complete = (commandId: string, status: "succeeded" | "failed") =>
			first.applyCommandResult({
				commandId,
				status,
				...(status === "failed" ? { errorCode: "provider_timeout" } : {}),
				updatedAt: "2026-09-12T01:01:00Z",
			});
		await first.submitCorrection({ ...base("edit"), text: "先给一句结论" });
		expect(
			(await first.listPendingAdmissions({ limit: 100 })).filter(
				(c) => c.ownerUserId === ownerUserId,
			),
		).toEqual([
			expect.objectContaining({
				commandId: accepted.commandId,
				item: { text: "先给结论" },
				schemaVersion: "personal_memory_command.v3",
			}),
		]);
		await first.markCommandAdmitted({
			commandId: accepted.commandId,
			admittedAt: "2026-09-12T01:00:01Z",
		});
		expect(
			(await first.listPendingAdmissions({ limit: 100 })).filter(
				(c) => c.ownerUserId === ownerUserId,
			),
		).toEqual([]);
		expect(await complete(accepted.commandId, "succeeded")).toBe("applied");
		expect(
			(await first.listPendingAdmissions({ limit: 100 })).filter(
				(c) => c.ownerUserId === ownerUserId,
			),
		).toEqual([expect.objectContaining({ commandId: base("edit").commandId })]);
		expect(await complete(base("edit").commandId, "failed")).toBe("applied");
		expect(await first.listByOwner(ownerUserId)).toMatchObject({
			syncStatus: "synced",
			operations: [
				expect.objectContaining({ commandId: base("edit").commandId, status: "failed" }),
			],
		});
		const retry = await first.retryCommand({
			...base("retry"),
			failedCommandId: base("edit").commandId,
		});
		expect(
			(await first.listPendingAdmissions({ limit: 100 })).filter(
				(c) => c.ownerUserId === ownerUserId,
			),
		).toEqual([
			expect.objectContaining({
				commandId: retry.commandId,
				item: { text: "先给一句结论" },
			}),
		]);
		await complete(retry.commandId, "succeeded");
		await first.submitCorrection({ ...base("disable"), text: "不再需要结论" });
		await first.erase(base("erase"));
		const db = requireClient(client);
		const payloads = await db.query(
			"select payload from profile.memory_commands where owner_user_id=$1",
			[ownerUserId],
		);
		expect(payloads.rows.every((row) => row.payload === null)).toBe(true);
		await complete(base("erase").commandId, "succeeded");
		expect(await first.listByOwner(ownerUserId)).toMatchObject({
			lifecycleState: "erased",
			syncStatus: "synced",
			operations: [],
		});
		await expect(
			first.submitCorrection({ ...base("after"), text: "blocked" }),
		).rejects.toMatchObject({
			code: "profile_memory_not_ready",
		});
		await first.setLifecycle({ ...base("enable"), lifecycleState: "active" });
		expect(await first.listByOwner(ownerUserId)).toMatchObject({
			lifecycleState: "active",
			syncStatus: "pending",
		});
	});

	it("coalesces repeated erase requests and retries failed erase in the same generation", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `erase-owner-${suffix}`;
		const store = createPgProfileMemoryStore({ getDb: getDb });
		const dbClient = requireClient(client);

		await expect(
			store.erase({
				commandId: `erase-first-${suffix}`,
				idempotencyKeyHash: `erase-idem-first-${suffix}`,
				ownerUserId,
				requestFingerprint: `erase-request-first-${suffix}`,
				updatedAt: "2026-07-16T05:00:00.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erased", syncStatus: "pending" });

		await expect(
			store.erase({
				commandId: `erase-pending-duplicate-${suffix}`,
				idempotencyKeyHash: `erase-idem-pending-${suffix}`,
				ownerUserId,
				requestFingerprint: `erase-request-pending-${suffix}`,
				updatedAt: "2026-07-16T05:00:01.000Z",
			}),
		).resolves.toMatchObject({ lifecycleState: "erased", syncStatus: "pending" });

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
		).resolves.toMatchObject({ lifecycleState: "erased", syncStatus: "pending" });

		await expect(
			store.applyCommandResult({
				commandId: `erase-first-${suffix}`,
				errorCode: "personal_memory_command_failed",
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
		).resolves.toMatchObject({ lifecycleState: "erased", syncStatus: "pending" });

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

	it("deletes conversations without creating memory cleanup commands", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `source-owner-${suffix}`;
		const conversationId = `source-conversation-${suffix}`;
		const chatStore = createPgChatConversationStore({ getDb: getDb });
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

		const commands = await dbClient.query(
			"select command_id from profile.memory_commands where owner_user_id=$1",
			[ownerUserId],
		);
		expect(commands.rows).toEqual([]);
		expect(
			await createPgProfileMemoryStore({ getDb: getDb }).listByOwner(ownerUserId),
		).toMatchObject({
			lifecycleState: "active",
			syncStatus: "synced",
		});
	});

	it("prunes conversation messages without mutating personal memory", async () => {
		const suffix = Date.now().toString(36);
		const ownerUserId = `prune-owner-${suffix}`;
		const conversationId = `prune-conversation-${suffix}`;
		const sourcePrefix = `prune-message-${suffix}-`;
		const chatStore = createPgChatConversationStore({ getDb: getDb });
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

		const memoryStore = createPgProfileMemoryStore({ getDb: getDb });
		const pending = (await memoryStore.listPendingAdmissions({ limit: 20 })).filter(
			(command) => command.ownerUserId === ownerUserId,
		);
		expect(pending).toEqual([]);
		expect(await memoryStore.listByOwner(ownerUserId)).toMatchObject({
			lifecycleState: "active",
			syncStatus: "synced",
		});
	});
});
