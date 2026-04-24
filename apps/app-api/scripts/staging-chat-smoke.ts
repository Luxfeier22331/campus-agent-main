import { randomBytes } from "node:crypto";
import process from "node:process";

import { Client } from "pg";

import { createApp } from "../src/app";
import {
	buildSmokeIdentityProvisionRuntimeEnv,
	provisionSmokeIdentity,
	readSmokeIdentityProvisionInput,
} from "./provision-smoke-identity-lib.mjs";
import { buildCookieHeader, expectJsonResponse, readJsonResponse } from "./smoke-auth-runtime";
import { parseStagingChatSmokeArgs } from "./staging-chat-smoke.args";

const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function resolveSslConfig(databaseSslMode: string) {
	return databaseSslMode === "disable"
		? false
		: {
				rejectUnauthorized: false as const,
			};
}

function resolveOperatorConnectionString(env: NodeJS.ProcessEnv): string {
	const connectionString =
		env.APP_API_OPERATOR_DATABASE_URL?.trim() || env.APP_API_MANAGEMENT_DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error(
			"APP_API_OPERATOR_DATABASE_URL is required. Legacy APP_API_MANAGEMENT_DATABASE_URL is accepted as a compatibility alias.",
		);
	}

	const nextUrl = new URL(connectionString);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

function readDatabaseSslMode(env: NodeJS.ProcessEnv): string {
	return env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
		? "disable"
		: env.APP_API_DATABASE_SSLMODE?.trim() === "prefer"
			? "prefer"
			: "require";
}

function buildSmokePassword(): string {
	return `SmokePass!${randomBytes(12).toString("base64url")}`;
}

async function fetchJsonWithCookie<T>(input: {
	body?: unknown;
	cookieHeader: string;
	expectedStatus: number;
	idempotencyKey?: string;
	method?: string;
	url: string;
}): Promise<{ payload: T; response: Response }> {
	const response = await fetch(input.url, {
		method: input.method ?? "GET",
		headers: {
			accept: "application/json",
			...(input.body
				? {
						"content-type": "application/json",
					}
				: {}),
			cookie: input.cookieHeader,
			...(input.idempotencyKey
				? {
						"idempotency-key": input.idempotencyKey,
					}
				: {}),
		},
		body: input.body ? JSON.stringify(input.body) : undefined,
		signal: AbortSignal.timeout(120_000),
	});

	return {
		payload: await expectJsonResponse<T>(response, input.expectedStatus),
		response,
	};
}

async function fetchReadyz(url: string): Promise<{ payload: unknown; status: number }> {
	const response = await fetch(url, {
		headers: {
			accept: "application/json",
		},
		signal: AbortSignal.timeout(30_000),
	});
	const payload = await readJsonResponse(response);
	if (response.status !== 200) {
		throw new Error(
			`Expected readyz 200 from ${url}, received ${response.status}: ${JSON.stringify(payload)}`,
		);
	}

	return {
		payload,
		status: response.status,
	};
}

async function mintStagingSmokeSession(input: {
	appApiReadyzUrl: string;
	email: string;
	password: string;
	smokeAuthSecret: string;
}): Promise<string> {
	const response = await fetch(
		new URL("/api/internal/staging-smoke/auth/session", input.appApiReadyzUrl).toString(),
		{
			body: JSON.stringify({
				email: input.email,
				password: input.password,
			}),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-app-staging-smoke-auth": input.smokeAuthSecret,
			},
			method: "POST",
			signal: AbortSignal.timeout(30_000),
		},
	);
	const payload = await readJsonResponse(response);
	if (!response.ok) {
		throw new Error(
			`Staging smoke session mint failed (${response.status}): ${JSON.stringify(payload)}`,
		);
	}

	return buildCookieHeader(response);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env) {
	const args = parseStagingChatSmokeArgs(argv, env);
	const smokeEnv = {
		...env,
		AUTH_TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
		APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN: TURNSTILE_TEST_TOKEN,
		APP_API_SMOKE_IDENTITY_PASSWORD: buildSmokePassword(),
		PUBLIC_CHAT_WEB_ORIGIN: args.chatBaseUrl,
	};
	const provisionInput = readSmokeIdentityProvisionInput(
		["--email", args.email, "--name", args.name],
		smokeEnv,
	);
	const runtimeEnv = buildSmokeIdentityProvisionRuntimeEnv(provisionInput);
	const client = new Client({
		connectionString: resolveOperatorConnectionString(smokeEnv),
		ssl: resolveSslConfig(readDatabaseSslMode(smokeEnv)),
	});

	await client.connect();

	try {
		const app = createApp(runtimeEnv);
		const appFetch = (request: Request) => app.fetch(request);

		const identitySummary = await provisionSmokeIdentity(
			{
				...provisionInput,
				runtimeEnv,
			},
			{
				appFetch,
				async executeSql(sql: string, params: unknown[]) {
					return client.query(sql, params);
				},
			},
		);
		const cookieHeader = await mintStagingSmokeSession({
			appApiReadyzUrl: args.appApiReadyzUrl,
			email: provisionInput.email,
			password: provisionInput.password,
			smokeAuthSecret: args.smokeAuthSecret,
		});

		const execReadyz = await fetchReadyz(args.execReadyzUrl);
		const appApiReadyz = await fetchReadyz(args.appApiReadyzUrl);
		const chatReadyz = await fetchReadyz(new URL("/readyz", args.chatBaseUrl).toString());
		const meResult = await fetchJsonWithCookie<{
			permissions: {
				chat: boolean;
				operator: boolean;
			};
			principal: {
				email: string | null;
				principalId: string;
				type: string;
			};
			session: {
				expiresAt: string;
				sessionId: string;
			} | null;
		}>({
			cookieHeader,
			expectedStatus: 200,
			url: new URL("/api/me", args.chatBaseUrl).toString(),
		});
		const beforeConversations = await fetchJsonWithCookie<{
			conversations: Array<{ id: string; title: string }>;
		}>({
			cookieHeader,
			expectedStatus: 200,
			url: new URL("/api/chat/conversations", args.chatBaseUrl).toString(),
		});
		const requestResult = await fetchJsonWithCookie<{
			answer: {
				conversation: {
					id: string;
				};
				result: {
					kind: string;
					requestId: string;
					traceId: string;
				};
			};
		}>({
			body: {
				prompt: args.prompt,
			},
			cookieHeader,
			expectedStatus: 200,
			idempotencyKey: `staging-chat-smoke-${Date.now()}`,
			method: "POST",
			url: new URL("/api/chat/requests", args.chatBaseUrl).toString(),
		});
		const conversationId = requestResult.payload.answer.conversation.id;
		const afterConversations = await fetchJsonWithCookie<{
			conversations: Array<{ id: string; title: string }>;
		}>({
			cookieHeader,
			expectedStatus: 200,
			url: new URL("/api/chat/conversations", args.chatBaseUrl).toString(),
		});
		const historyHasConversation = afterConversations.payload.conversations.some(
			(conversation) => conversation.id === conversationId,
		);
		if (!historyHasConversation) {
			throw new Error(
				`Conversation ${conversationId} was not present in /api/chat/conversations after the live smoke request.`,
			);
		}

		console.log(
			JSON.stringify(
				{
					identity: {
						clearedConversationCount: identitySummary.clearedConversationCount,
						clearedSessionCount: identitySummary.clearedSessionCount,
						deletedUserCount: identitySummary.deletedUserCount,
						email: identitySummary.email,
						userId: identitySummary.userId,
					},
					principal: meResult.payload.principal,
					request: {
						conversationId,
						historyCountAfter: afterConversations.payload.conversations.length,
						historyCountBefore: beforeConversations.payload.conversations.length,
						historyHasConversation,
						prompt: args.prompt,
						requestId:
							requestResult.response.headers.get("x-request-id") ??
							requestResult.payload.answer.result.requestId,
						resultKind: requestResult.payload.answer.result.kind,
						traceId:
							requestResult.response.headers.get("x-trace-id") ??
							requestResult.payload.answer.result.traceId,
					},
					session: meResult.payload.session,
					surfaceChecks: {
						appApiReadyz: {
							status: appApiReadyz.status,
							url: args.appApiReadyzUrl,
						},
						chatReadyz: {
							status: chatReadyz.status,
							url: new URL("/readyz", args.chatBaseUrl).toString(),
						},
						execReadyz: {
							status: execReadyz.status,
							url: args.execReadyzUrl,
						},
					},
				},
				null,
				2,
			),
		);
	} finally {
		await client.end();
	}
}

void main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
