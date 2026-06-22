// @vitest-environment node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { Env } from "../src/config";
import { createPgChatConversationStore } from "../src/modules/chat";
import type {
	CapabilityExecutionInput,
	CapabilityExecutionResponse,
} from "../src/modules/integration/execution-control";
import { buildChatCommandService, createPgChatCommandStore } from "../src/modules/runtime-command";
import { createExecutionRuntimeFromCapabilityClient } from "./chat-command.service.test-support";
import {
	buildSharedDbIntegrationEnv,
	convergeSharedDbForAppApiIntegration,
	resolveSharedDbSslConfig,
} from "./shared-db-integration-helpers";

const RUN_INTEGRATION = process.env.RUN_APP_API_SHARED_DB_INTEGRATION === "1";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFilePath = resolve(appRoot, ".env");
const devVarsFilePath = resolve(appRoot, ".dev.vars");
const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

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

describe.skipIf(!RUN_INTEGRATION)("app-api shared product DB integration", () => {
	let app: ReturnType<typeof createApp>;
	let client: Client | null = null;
	let createdEmail: string | null = null;
	let env: Env;

	beforeAll(async () => {
		const { managementConnectionString, runtimeConnectionString } =
			await convergeSharedDbForAppApiIntegration({
				contextLabel: "the app-api shared product DB integration test",
				devVarsFilePath,
				envFilePath,
			});

		env = buildSharedDbIntegrationEnv({
			managementConnectionString,
			runtimeConnectionString,
		});

		app = createApp(env);
		client = new Client({
			connectionString: managementConnectionString,
			ssl: resolveSharedDbSslConfig(),
		});
		await client.connect();
	});

	afterAll(async () => {
		if (!client) {
			return;
		}
		if (createdEmail) {
			await client.query(
				`
          delete from "chat"."conversations"
          where "owner_user_id" in (
            select "id" from "app_auth"."user" where "email" = $1
          )
        `,
				[createdEmail],
			);
			await client.query(`delete from "app_auth"."user" where "email" = $1`, [createdEmail]);
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
		createdEmail = `integration-${Date.now()}@muc.edu.cn`;
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
		createdEmail = `integration-${Date.now()}@muc.edu.cn`;
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

		const supervisor: {
			execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResponse>;
		} = {
			execute: vi
				.fn()
				.mockResolvedValueOnce({
					answerText: "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
					error: null,
					followUpQuestion: "",
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
					selectedCapability: "knowledge",
					status: "completed",
					traceId: "trace_eval_curriculum_01",
				})
				.mockResolvedValueOnce({
					answerText: "第二学期有中国法制史。",
					error: null,
					followUpQuestion: "",
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
					selectedCapability: "knowledge",
					status: "completed",
					traceId: "trace_eval_curriculum_02",
				}),
		};
		const appWithRealCommand = createApp(env, {
			chatCommandService: buildChatCommandService({
				conversationStore: createPgChatConversationStore(env),
				store: createPgChatCommandStore(env),
				executionRuntime: createExecutionRuntimeFromCapabilityClient(supervisor),
			}),
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
					requestedScope: {
						corpus: "curriculum",
						collection: "curriculum_plan",
					},
				}),
			}),
		);

		expect(firstRequestResponse.status).toBe(200);

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
					requestedScope: {
						corpus: "curriculum",
						collection: "curriculum_plan",
					},
				}),
			}),
		);

		expect(secondRequestResponse.status).toBe(200);

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
});
